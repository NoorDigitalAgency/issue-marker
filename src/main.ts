import { debug, endGroup, getInput, startGroup, warning } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { load, dump } from 'js-yaml';
import { context, getOctokit } from '@actions/github';
import { EOL } from 'os';
import { inspect } from 'util';
import type { QueryData, PullRequest, Issue, Label } from './types';

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

    if (stage === 'alpha') {

      await exec('git', ['fetch', '--all']);

      const logOutput = await getExecOutput('git', ['log', previousVersion ? `${previousVersion}...${version}` : version, '--reverse', '--merges', '--oneline', '--no-abbrev-commit',  `--grep='Merge pull request #'`]);

      if (logOutput.exitCode !== 0) throw new Error(logOutput.stderr);

      const log = logOutput.stdout;

      startGroup('Log Output');

      debug(log);

      endGroup();

      const merges = [...(log.matchAll(logRegex) ?? [])].map(merge => ({hash: merge.groups!.hash!, number: +merge.groups!.number!}));

      if (merges.length === 0) throw new Error('No merges found.');

      const pullRequests = new Array<PullRequest>();

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

      pullRequests.filter(pullRequest => pullRequest.closed && pullRequest.issues.nodes.length > 0).map(pullRequest => pullRequest);

    } else {


    }

    // All the commits
    // git log v1.6.0...v1.7.0 --reverse --merges --oneline
    // git branch -r --contains <commit> // get branches which contain the commit
    /*


{
  "owner": "NoorDigitalAgency",
  "name": "startup-debug",
  "numaber": 25
}

{
  "data": {
    "repository": {
      "pullRequest": {
        "number": 10,
        "title": "sync: master to development",
        "closed": true,
        "issues": {
          "nodes": [
            {
              "body": "### Describe this feature's value\n<!--A clear and concise description of what the feature is and how it is going to add value to the project.-->\nThe recruiter should be able to ask the candidate to provide a video presentation on the candidate board.\n\n\n### Describe the Solution\n\n\n### Additional Context\n<!-- Add any other context or screenshots about the feature request here. -->\n\n\n### DoD\n- \n\n### How should be tested?\n\n\n",
              "closed": false,
              "number": 593,
              "labels": {
                "nodes": [
                  {
                    "name": "enhancement"
                  }
                ]
              }
            },
            {
              "body": "### Describe this feature's value\n<!--A clear and concise description of what the feature is and how it is going to add value to the project.-->\nThe recruiter should be able to provide the candidate with a case study on the candidate board.\n\n\n### Describe the Solution\n\n\n### Additional Context\n<!-- Add any other context or screenshots about the feature request here. -->\n\n\n### DoD\n- \n\n### How should be tested?\n\n\n\n\n\n### Describe the Solution\n\n\n### Additional Context\n<!-- Add any other context or screenshots about the feature request here. -->\n\n\n### DoD\n- \n\n### How should be tested?\n\n\n",
              "closed": false,
              "number": 594,
              "labels": {
                "nodes": [
                  {
                    "name": "enhancement"
                  }
                ]
              }
            },
            {
              "body": "### Describe this feature's value\n<!--A clear and concise description of what the feature is and how it is going to add value to the project.-->\nAfter the release of the UI, we have to make sure that the users are using the latest UI version.\n\n\n### Describe the Solution\n\n\n### Additional Context\n<!-- Add any other context or screenshots about the feature request here. -->\n\n\n### DoD\n- \n\n### How should be tested?\n\n\n",
              "closed": false,
              "number": 642,
              "labels": {
                "nodes": [
                  {
                    "name": "enhancement"
                  },
                  {
                    "name": "needs confirmation"
                  },
                  {
                    "name": "Epic"
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}
    */
    const issues = await octokit.rest.search.issuesAndPullRequests({q: ''})

  } catch (error) {

    startGroup('Error');

    debug(inspect(error));

    endGroup();

    if (error instanceof Error) warning(error.message);
  }
}

run();
