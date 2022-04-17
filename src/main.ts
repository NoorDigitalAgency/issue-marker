import { getInput, setFailed } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { load, dump } from 'js-yaml';
import { context, getOctokit } from '@actions/github';
import { EOL } from 'os';

async function run(): Promise<void> {
  try {
    const version = getInput('version');
    const previousVersion = getInput('previous_version');
    const stage = getInput('stage');
    const token = getInput('token');
    const octokit = getOctokit(token);
    await exec('git', ['fetch', '--all']);
    await getExecOutput('git', ['log', previousVersion ? `${previousVersion}...${version}` : version, '--reverse', '--merges', '--oneline', '--no-abbrev',  `--grep='Merge pull request #'`]);
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
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
