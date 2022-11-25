import { debug, endGroup, getBooleanInput, getInput, startGroup, warning } from '@actions/core';
import { getExecOutput } from '@actions/exec';
import { context, getOctokit } from '@actions/github';
import { inspect } from 'util';
import { getIssueMetadata } from './functions';
import type { Link } from './types';
import {ZenHubClient} from "./zenhub-client";

async function run(): Promise<void> {

  enum Phase {
    before = 'before',
    after = 'after',
    jump = 'jump'
  }

  try {

    const productionRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}$/;

    const betaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-beta\.\d{1,3}$/;

    const alphaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-alpha\.\d{1,3}$/;

    const logRegex = /^(?<hash>[0-9a-f]{40}) Merge pull request #(?<number>\d+) from .+?$/mg;

    const issueRegex = /https:\/\/api\.github\.com\/repos\/(?<repository>.+?)\/issues\/\d+/;

    const branchRegex = /^.+?\/(?<branch>[^\/\s]+)\s*$/mg;

    const idRegex = /^(?<owner>.+?)\/(?<repo>.+?)#(?<number>\d+)$/;

    const linkRegex = /(?:(?<owner>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\/(?<repo>[A-Za-z0-9-._]+))?#(?<issue>\d+)/ig;

    const phase = getInput('phase') as Phase;

    debug(`Phase: '${phase}'.`);

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

    const reference = getInput('reference', {required: true});

    debug(`Reference: '${reference}'.`);

    const close = getBooleanInput('close-issues');

    debug(`Close Issue: ${close}.`);

    const stage = productionRegex.test(version) ? 'production' : betaRegex.test(version) ? 'beta' : alphaRegex.test(version) ? 'alpha' : null;

    debug(`Stage: '${stage}'.`);

    if (typeof (stage) === 'undefined') throw new Error('Problem in detecting the stage.');

    if (stage === 'alpha' && phase === Phase.before) return;

    const octokit = getOctokit(token);

    const issues = new Array<{id: string; body: string; labels: Array<string>}>();

    if (stage === 'alpha' && phase === Phase.after) {

      const logOutput = await getExecOutput('git', ['log', previousVersion ? `${previousVersion}...${version}` :

        version, '--reverse', '--merges', '--oneline', '--no-abbrev-commit']);

      if (logOutput.exitCode !== 0) throw new Error(logOutput.stderr);

      const log = logOutput.stdout;

      startGroup('Log Output');

      debug(log);

      endGroup();

      const merges = [...(log.matchAll(logRegex) ?? [])].map(merge => ({hash: merge.groups!.hash!, number: +merge.groups!.number!}));

      if (merges.length === 0) throw new Error('No merges found.');

      const owner = context.repo.owner;

      const repo = context.repo.repo;

      startGroup('Repo Object');

      debug(inspect(context.repo));

      endGroup();

      for (const merge of merges) {

        const pullRequest = (await octokit.rest.issues.get({ owner, repo, issue_number: merge.number })).data;

        const body = pullRequest.body ?? '';

        startGroup('PR Body');

        debug(inspect(body));

        endGroup();

        const linkGroups = [...body.matchAll(linkRegex)].map(link => link.groups! as unknown as Link);

        startGroup('Link Groups');

        debug(inspect(linkGroups));

        endGroup();

        const links = linkGroups

          .filter((link, i, all) => all.findIndex(l => `${link.owner?.toLowerCase() ?? owner}/${link.repo?.toLowerCase() ?? repo}#${link.issue}` === `${l.owner?.toLowerCase() ?? owner}/${l.repo?.toLowerCase() ?? repo}#${l.issue}`) === i);

        startGroup('Links');

        debug(inspect(links));

        endGroup();

        for (const link of links) {

          const issue = (await octokit.rest.issues.get({ owner: link.owner ?? owner, repo: link.repo ?? repo, issue_number: +link.issue })).data;

          if (issue.state !== 'closed' && !issue.pull_request && issue.labels.every(label => ['beta', 'production'].every(stageLabel => (typeof(label) === 'string' ? label : label.name) ?? '' !== stageLabel))) {

            const { repository } = issue.url.match(issueRegex)!.groups!;

            issues.push({

              id: `${repository}#${link.issue}`,

              ...getIssueMetadata({stage, body: issue.body ?? '', commit: merge.hash, labels: issue.labels.filter(label => typeof(label) === 'string' ? label : label.name)

                .map(label => typeof(label) === 'string' ? label : label.name).filter(label => typeof(label) === 'string') as Array<string>,

                repository: `${owner}/${repo}`, version})
            });
          }
        }
      }

    } else if (stage === 'production' || stage === 'beta') {

      const currentBranch = stage === 'production' ? 'main' : 'release';

      const filterLabel = stage === 'production' ? 'beta' : 'alpha';

      const query = `"application: 'issue-marker'" AND "repository: '${context.repo.owner}/${context.repo.repo}'" type:issue state:open in:body label:${filterLabel}`;

      debug(`Query: ${query}`);

      const items = (await octokit.rest.search.issuesAndPullRequests({ q: query })).data.items;

      startGroup('Query Items');

      debug(inspect(items));

      endGroup();

      for (const issue of items) {

        debug(`Issue ${issue.repository}#${issue.number}`);

        const { repository } = issue.url.match(issueRegex)!.groups!;

        const {body, commit, labels} = getIssueMetadata({stage, body: issue.body ?? '', labels: issue.labels.map(label => label.name ?? '').filter(label => label !== ''), version, commit: reference});

        startGroup('Issue Body');

        debug(issue.body ?? '');

        endGroup();

        startGroup('Modified Body');

        debug(body);

        endGroup();

        const branchesOutput = await getExecOutput('git', ['branch', '-r', '--contains', commit]);

        if (branchesOutput.exitCode !== 0) {

          warning(`Wrong linking to commit ${commit} from issue ${issue.repository}#${issue.number}.`);

          continue;
        }

        const branches = branchesOutput.stdout;

        if ([...branches.matchAll(branchRegex)].map(branch => branch.groups!.branch).includes(currentBranch)) issues.push({id: `${repository}#${issue.number}`, body, labels});
      }

    }

    if (issues.length === 0 && phase === Phase.after) throw new Error('No issues to mark.');

    startGroup('Issues');

    debug(inspect(issues));

    endGroup();

    for (const issue of issues) {

      try {

        const {owner, repo, number} = issue.id.match(idRegex)!.groups!;

        await octokit.rest.issues.update({ owner, repo, issue_number: +number, body: issue.body, labels: issue.labels, state: close && stage === 'production' ? 'closed' : undefined});

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

const token = process.env.GITHUB_PAT;

const octokit = getOctokit(token!);

const client = new ZenHubClient('zh_ea3c42a7040b19c2b7e30ee976ed5e944cc72c8910c3a08aacb3685554f4d557', '610932e45f62cf00178cc02e', octokit);

client.getGitHubRepositoryId('NoorDigitalAgency', 'ledigajobb-general').then(value => {

  const v = value;

  debugger;

});

client.getGitHubIssueId('NoorDigitalAgency', 'ledigajobb-general', 920).then(value => {

  const v = value;

  debugger;

});

//run();
