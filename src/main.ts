import { debug, endGroup, getInput, startGroup, warning } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { load, dump } from 'js-yaml';
import { context, getOctokit } from '@actions/github';
import { EOL } from 'os';

async function run(): Promise<void> {

  try {

    const productionRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}$/i;

    const betaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-beta\.\d{1,3}$/i;

    const alphaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-alpha\.\d{1,3}$/i;

    const logRegex = /^([0-9a-f]{40}) Merge pull request #(\d+) from .+?$/m;

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

      const merges = [...log.matchAll(logRegex)];

      if (merges == null || merges.length === 0) throw new Error('No merges found.');

    } else {


    }

    octokit.graphql('');
    // All the commits
    // git log v1.6.0...v1.7.0 --reverse --merges --oneline
    // git branch -r --contains <commit> // get branches which contain the commit
    /*
query PullRequestIssues($owner: String!, $name: String!, $numaber: Int!) {
  repository(name: $name, owner: $owner) {
    pullRequest(number: $numaber) {
      number
      title
      closingIssuesReferences(userLinkedOnly: true, first: 100) {
        totalCount
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

{
  "owner": "NoorDigitalAgency",
  "name": "startup-debug",
  "numaber": 25
}

{
  "data": {
    "repository": {
      "pullRequest": {
        "number": 25,
        "title": "Generated PR for production/v2022.4",
        "closingIssuesReferences": {
          "totalCount": 1,
          "nodes": [
            {
              "body": "# The title\r\n## Subtitle \r\n- Information\r\n- [ ] More information\r\n\r\nMore information\r\n\r\n<details>\r\n<!—Do not edit this block—>\r\n<summary>Test Metadata</summary>\r\n\r\n```yaml\r\nrepository: NoorDigitalAgency/startup-debug\r\ncommit: 1736392639272\r\nversions:\r\n    - v1.0\r\n    - V2.0\r\n```\r\n</details>",
              "closed": false,
              "number": 35,
              "labels": {
                "nodes": []
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
    if (error instanceof Error) warning(error.message);
  }
}

run();
