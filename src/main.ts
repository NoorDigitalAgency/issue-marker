import { debug, endGroup, getInput, startGroup, warning } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { context, getOctokit } from '@actions/github';
import { inspect } from 'util';
import { getIssueMetadata } from './functions';
import type { Link, PullRequest } from './types';

async function run(): Promise<void> {

  try {

    const productionRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}$/;

    const betaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-beta\.\d{1,3}$/;

    const alphaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-alpha\.\d{1,3}$/;

    const logRegex = /^(?<hash>[0-9a-f]{40}) Merge pull request #(?<number>\d+) from .+?$/mg;

    const issueRegex = /https:\/\/api\.github\.com\/repos\/(?<repository>.+?)\/issues\/\d+/;

    const branchRegex = /^.+?\/(?<branch>[^\/\s]+)\s*$/m;

    const idRegex = /^(?<owner>.+?)\/(?<repo>.+?)#(?<number>\d+)$/;

    const linkRegex = /(?<owner>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\/(?<repo>[A-Za-z0-9-._]+)#(?<issue>\d+)/ig;

    const version = getInput('version', {required: true});

    debug(`Version: '${version}'.`);

    if ([productionRegex, betaRegex, alphaRegex].every(regex => !regex.test(version))) throw new Error(`Invalid Version '${version}'.`);

    const previousVersion = getInput('previous-version');

    debug(`Previous Version: '${previousVersion}'.`);

    if (previousVersion !== '' && [productionRegex, betaRegex, alphaRegex].every(regex => !regex.test(previousVersion))) throw new Error(`Invalid Previous Version '${previousVersion}'.`);

    if (previousVersion !== '' && [productionRegex, betaRegex, alphaRegex].some(regex => regex.test(version) !== regex.test(previousVersion)))

      throw new Error(`Version '${version}' and Previous Version '${previousVersion}' are from different stages.`);

    const token = getInput('token', {required: true});

    debug(`Token: '${token}'.`);

    const stage = productionRegex.test(version) ? 'production' : betaRegex.test(version) ? 'beta' : alphaRegex.test(version) ? 'alpha' : null;

    debug(`Stage: '${stage}'.`);

    if (typeof (stage) === 'undefined') throw new Error('Problem in detecting the stage.');

    const octokit = getOctokit(token);

    const issues = new Array<{id: string; body: string; labels: Array<string>}>();

    if (stage === 'alpha') {

      await exec('git', ['fetch', '--all']);

      const logOutput = await getExecOutput('git', ['log', previousVersion ? `${previousVersion}...${version}` :

        version, '--reverse', '--merges', '--oneline', '--no-abbrev-commit',  `--grep='Merge pull request #'`]);

      if (logOutput.exitCode !== 0) throw new Error(logOutput.stderr);

      const log = logOutput.stdout;

      startGroup('Log Output');

      debug(log);

      endGroup();

      const merges = [...(log.matchAll(logRegex) ?? [])].map(merge => ({hash: merge.groups!.hash!, number: +merge.groups!.number!}));

      if (merges.length === 0) throw new Error('No merges found.');

      let pullRequests = new Array<PullRequest>();

      for (const merge of merges) {

        const pullRequest = (await octokit.rest.issues.get({ owner: context.repo.owner, repo: context.repo.repo, issue_number: merge.number })).data;

        let comments = pullRequest.body ?? '';

        if (pullRequest.comments > 0) {

          comments += (await octokit.rest.issues.listComments({ owner: context.repo.owner, repo: context.repo.repo, issue_number: merge.number })).data.join(' ');
        }

        const links = [...comments.matchAll(linkRegex)].map(link => link.groups! as unknown as Link);

        for (const link of links) {
        }

        pullRequests.push(pullRequest);
      }

      startGroup('Loaded pull requests');

      debug(inspect(pullRequests));

      endGroup();

      pullRequests = pullRequests.map(pullRequest => ({...pullRequest, issues: {nodes: pullRequest.issues.nodes.filter(issue => !issue.closed &&

        issue.labels.nodes.every(label => ['alpha', 'beta', 'production'].every(stageLabel => label.name !== stageLabel)))}}))

        .filter(pullRequest => pullRequest.closed && pullRequest.issues.nodes.length > 0);

      startGroup('Filtered pull requests');

      debug(inspect(pullRequests));

      endGroup();

      const commitIssues = pullRequests.map(pullRequest => ({hash: merges.filter(merge => merge.number === pullRequest.number).pop()!.hash, issues: pullRequest.issues.nodes}))

        .flatMap(commitIssue => commitIssue.issues.map(issue => ({hash: commitIssue.hash, issue: issue})));

      for (const commitIssue of commitIssues) {

        issues.push({id: `${commitIssue.issue.repository.owner}/${commitIssue.issue.repository.name}#${commitIssue.issue.number}`,

          ...getIssueMetadata({stage, body: commitIssue.issue.body, commit: commitIssue.hash, labels: commitIssue.issue.labels.nodes.map(label => label.name),

            repository: `${commitIssue.issue.repository.owner.login}/${commitIssue.issue.repository.name}`, version})});
      }

    } else if (stage === 'production' || stage === 'beta') {

      const currentBranch = stage === 'production' ? 'main' : 'release';

      await exec('git', ['fetch', '--all']);

      const filterLabel = stage === 'production' ? 'beta' : 'alpha';

      const query = `q=${encodeURIComponent(`"application: 'issue-marker'" AND "repository: '${context.repo.owner}/${context.repo.repo}'" type:issue state:open in:body linked:pr label:${filterLabel}`)}`;

      const items = (await octokit.rest.search.issuesAndPullRequests({ q: query })).data.items;

      for (const issue of items) {

        const { repository } = issue.url.match(issueRegex)!.groups!;

        const {body, commit, labels} = getIssueMetadata({stage, body: issue.body ?? '', labels: issue.labels.map(label => label.name ?? '').filter(label => label !== ''), version});

        const branchesOutput = await getExecOutput('git', ['branch', '-r', '--contains', commit]);

        if (branchesOutput.exitCode !== 0) throw new Error(branchesOutput.stderr);

        const branches = branchesOutput.stdout;

        startGroup('Branches Output');

        debug(branches);

        endGroup();

        if ([...branches.matchAll(branchRegex)].map(branch => branch.groups!.branch).includes(currentBranch)) issues.push({id: `${repository}#${issue.number}`, body, labels});
      }

    }

    if (issues.length === 0) throw new Error('No issues to mark.');

    startGroup('Issues');

    debug(inspect(issues));

    endGroup();

    for (const issue of issues) {

      try {

        const {owner, repo, number} = issue.id.match(idRegex)!.groups!;

        await octokit.rest.issues.update({ owner, repo, issue_number: +number, body: issue.body, labels: issue.labels});

      } catch (error) {

        startGroup('Issue Update Error');

        debug(inspect(issue));

        debug(inspect(error));

        endGroup();

        if (error instanceof Error) warning(error.message);
      }
    }

  } catch (error) {

    startGroup('Error');

    debug(inspect(error));

    endGroup();

    if (error instanceof Error) warning(error.message);
  }
}

run();
