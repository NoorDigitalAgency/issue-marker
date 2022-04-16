import { getInput, setFailed } from '@actions/core';
import { load, dump } from 'js-yaml';
import { context, getOctokit } from '@actions/github';

async function run(): Promise<void> {
  try {
    const version = getInput('version');
    const previousVersion = getInput('previous_version');
    const stage = getInput('stage');
    const token = getInput('token');
    const octokit = getOctokit(token);
    // git fetch --all
    // If previous version is present
    // git log v1.6.0..v1.7.0 --reverse --merges --oneline --grep='Merge pull request #'
    // If no previous version is present
    // git log v1.7.0 --reverse --merges --oneline --grep='Merge pull request #'
    // All the commits
    // git log v1.6.0...v1.7.0 --reverse --merges --oneline
    // git branch -r --contains <commit> // get branches which contain the commit
    /*
query {
  resource(url: "https://github.com/NoorDigitalAgency/startup-debug/pull/25") {
    ... on PullRequest {
      closingIssuesReferences(first: 100) {
        nodes {
          number
        }
      }
    }
  }
}

{
  "data": {
    "resource": {
      "closingIssuesReferences": {
        "nodes": [
          {
            "number": 35
          }
        ]
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
