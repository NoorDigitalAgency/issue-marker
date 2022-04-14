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
    // git log --oneline --merges commit1...commit2 | grep 'Merge pull request #'
    // https://github.com/NoorDigitalAgency/lightning-test/issues/11
    const commits = (await octokit.rest.repos.compareCommits({ owner: context.repo.owner, repo: context.repo.repo, base: previousVersion ?? '', head: version })).data;
    const issues = await octokit.rest.search.issuesAndPullRequests({q: ''})
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
