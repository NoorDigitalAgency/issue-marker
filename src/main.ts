import { debug, endGroup, getInput, startGroup, warning } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { context, getOctokit } from '@actions/github';
import { EOL } from 'os';
import { inspect } from 'util';
import { getIssueMetadata } from './functions';
import type { QueryData, PullRequest, Issue } from './types';

async function run(): Promise<void> {

  try {

    const productionRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}$/i;

    const betaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-beta\.\d{1,3}$/i;

    const alphaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-alpha\.\d{1,3}$/i;

    const logRegex = /^(?<hash>[0-9a-f]{40}) Merge pull request #(?<number>\d+) from .+?$/m;

    const version = getInput('version', {required: true});

    debug(`Version: '${version}'.`);

    if ([productionRegex, betaRegex, alphaRegex].every(regex => !regex.test(version))) throw new Error(`Invalid Version '${version}'.`);

    const previousVersion = getInput('previous_version');

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

        const { pullRequest } = (await octokit.graphql<QueryData>(
          `
          query PullRequestIssues($owner: String!, $name: String!, $number: Int!) {

            repository(name: $name, owner: $owner) {

              pullRequest(number: $number) {

                number

                title

                closed

                issues: closingIssuesReferences(userLinkedOnly: true, first: 100) {

                  nodes {

                    body

                    closed

                    number

                    id

                    labels(first: 100) {

                      nodes {

                        name
                      }
                    }
                  }
                }
              }
            }
          }
          `,
          {
            owner: context.repo.owner,

            name: context.repo.repo,

            number: merge.number,

            headers: {

              authorization: `token ${token}`
            },
          }
        )).data.repository;

        pullRequests.push(pullRequest);
      }

      startGroup('Pull requests');

      debug('Loaded pull requests:');

      debug(inspect(pullRequests));

      pullRequests = pullRequests.map(pullRequest => ({...pullRequest, issues: {nodes: pullRequest.issues.nodes.filter(issue => !issue.closed &&
          
        issue.labels.nodes.every(label => ['alpha', 'beta', 'production'].every(stageLabel => label.name !== stageLabel)))}}))
        
        .filter(pullRequest => pullRequest.closed && pullRequest.issues.nodes.length > 0);

      debug('Filtered pull requests:');

      debug(inspect(pullRequests));

      endGroup();

      const hashIssues = pullRequests.map(pullRequest => ({hash: merges.filter(merge => merge.number === pullRequest.number).pop()!.hash, issues: pullRequest.issues.nodes}))
        
        .flatMap(hashIssue => hashIssue.issues.map(issue => ({hash: hashIssue.hash, issue: issue})));

      for (const hashIssue of hashIssues) {
        
        issues.push({id: hashIssue.issue.id, ...getIssueMetadata(stage, hashIssue.issue.labels.nodes.map(label => label.name), hashIssue.issue.body, hashIssue.hash, `${hashIssue.issue.repository.owner}/${hashIssue.issue.repository.name}`)});
      }

    } else if (stage === 'production' || stage === 'beta') {

      // git branch -r --contains <commit> // get branches which contain the commit

      const issue = (await octokit.rest.search.issuesAndPullRequests({q: ''})).data.items[0];

      // TODO: Should we label based on the branches regardless of the stage?

      // TODO: Check if hash exists on the stage's branch then

      const body = issue.body ?? '';

      const id = issue.node_id;

      const labels = issue.labels.map(label => label.name ?? '').filter(label => label !== '');

      issues.push({id, ...getIssueMetadata(stage, labels, body)});

    } else {

      throw new Error(`Ivalid stage '${stage}'.`);
    }

    // TODO: Update the issues
    // TODO: Investigate ZenHub's API

  } catch (error) {

    startGroup('Error');

    debug(inspect(error));

    endGroup();

    if (error instanceof Error) warning(error.message);
  }
}

run();
