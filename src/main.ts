import { debug, endGroup, getBooleanInput, getInput, startGroup, warning } from '@actions/core';
import { getOctokit } from '@actions/github';
import { inspect } from 'util';
import { deconstructIssueId, getTargetIssues, refineLabels } from './functions';
import { ZenHubClient } from "@noordigitalagency/zenhub-client";

async function run(): Promise<void> {

  try {

    const productionRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}$/;

    const betaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-beta\.\d{1,3}$/;

    const alphaRegex = /^v20[2-3]\d(?:\.\d{1,3}){1,2}-alpha\.\d{1,3}$/;

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

    const zenHubKey = getInput('zenhub-key');

    debug(`ZenHub Key: '${zenHubKey}'.`);

    const zenHubWorkspace = getInput('zenhub-workspace');

    debug(`ZenHub Workspace: '${zenHubWorkspace}'.`);

    const stage = productionRegex.test(version) ? 'production' : betaRegex.test(version) ? 'beta' : alphaRegex.test(version) ? 'alpha' : null;

    debug(`Stage: '${stage}'.`);

    if (typeof (stage) === 'undefined') throw new Error('Problem in detecting the stage.');

    const octokit = getOctokit(token);

    const client = new ZenHubClient(zenHubKey, zenHubWorkspace, octokit);

    const issues = (await getTargetIssues(stage!, version, previousVersion, reference, octokit)).map(issue => ({...issue, labels: refineLabels(issue.labels, issue.body, stage!)}));

    if (issues.length === 0) throw new Error('No issues to mark.');

    startGroup('Issues');

    debug(inspect(issues));

    endGroup();

    for (const issue of issues) {

      try {

        const {owner, repo, number} = deconstructIssueId(issue);

        if (client.enabled) {

          await client.moveGitHubIssue(owner, repo, +number, stage!);
        }

        const needsTest = issue.labels.map(label => label.trim().toLowerCase()).includes('test');

        await octokit.rest.issues.update({ owner, repo, issue_number: +number, body: issue.body, labels: issue.labels, state: close && !needsTest && stage === 'production' ? 'closed' : undefined});

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
