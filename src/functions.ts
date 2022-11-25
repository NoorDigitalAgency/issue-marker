import { load, dump } from 'js-yaml';
import {Link, Metadata} from './types';
import {getExecOutput} from "@actions/exec";
import {debug, endGroup, startGroup, warning} from "@actions/core";
import {context} from "@actions/github";
import {inspect} from "util";
import type {GitHub} from "@actions/github/lib/utils";

const openerComment = '<!--DO NOT EDIT THE BLOCK BELOW THIS COMMENT-->';

const closerComment = '<!--DO NOT EDIT THE BLOCK ABOVE THIS COMMENT-->';

const regex = new RegExp(`\\s+(?:${openerComment}\\s*)?<details data-id="issue-marker">.*?\`\`\`yaml\\s+(?<yaml>.*?)\\s+\`\`\`.*?<\\/details>(?:\\s*${closerComment})?\\s+`, 'ims');

export function getIssueMetadata (configuration: {stage: 'alpha'; labels: Array<string>; body: string; version: string; commit: string; repository: string} | {stage: 'beta' | 'production'; labels: Array<string>; body: string; version: string; commit: string}) {

    const { stage, labels, body } = {...configuration};

    const metadataYaml = (body ?? '').match(regex)?.groups?.yaml;

    if (stage !== 'alpha' && !metadataYaml) {

        throw new Error();
    }

    const { commit, repository, version, history } = configuration.stage === 'alpha' ?

        {...configuration, history: [{version: configuration.version, commit: configuration.commit}, ...(typeof(metadataYaml) === 'string' && metadataYaml !== '' ? {...load(metadataYaml) as Metadata}?.history ?? [] : [])]} :

        {...load(metadataYaml!) as Metadata};

    const metadata = { application: 'issue-marker', repository, version, commit, history } as Metadata;

    if (stage !== 'alpha') {

        metadata.version = configuration.version;

        metadata.commit = configuration.commit;

        metadata.history = [{version: configuration.version, commit: configuration.commit}, ...history];
    }

    const outputBody = `${regex.test(body) ? body.replace(regex, '\n\n') : body ?? ''}\n\n${summarizeMetadata(dump(metadata, {forceQuotes: true, quotingType: "'"}))}\n\n`;

    const outputLabels = labels.filter(label => !['alpha', 'beta', 'production'].includes(label)).concat([stage]);

    return { body: outputBody, labels: outputLabels, commit };
}

function summarizeMetadata (metadata: string) {

    return `${openerComment}\n<details data-id="issue-marker">\n<summary>Issue Marker's Metadata</summary>\n\n\`\`\`yaml\n${metadata}\`\`\`\n</details>\n${closerComment}`;
}

export async function getTargetIssues(stage: 'alpha' | 'beta' | 'production', version: string, previousVersion: string, reference: string, octokit: InstanceType<typeof GitHub>): Promise<Array<{id: string; body: string; labels: Array<string>}>> {

    const logRegex = /^(?<hash>[0-9a-f]{40}) Merge pull request #(?<number>\d+) from .+?$/mg;

    const issueRegex = /https:\/\/api\.github\.com\/repos\/(?<repository>.+?)\/issues\/\d+/;

    const branchRegex = /^.+?\/(?<branch>[^\/\s]+)\s*$/mg;

    const linkRegex = /(?:(?<owner>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\/(?<repo>[A-Za-z0-9-._]+))?#(?<issue>\d+)/ig;

    const issues = new Array<{id: string; body: string; labels: Array<string>}>();

    if (stage === 'alpha') {

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

    return issues;
}

export function deconstructIssue(issue: {id: string; body: string; labels: Array<string>}): {owner: string; repo: string; number: string} {

    const idRegex = /^(?<owner>.+?)\/(?<repo>.+?)#(?<number>\d+)$/;

    return issue.id.match(idRegex)!.groups! as {owner: string; repo: string; number: string};
}
