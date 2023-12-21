import { load, dump } from 'js-yaml';
import {Link, Metadata} from './types';
import {getExecOutput} from "@actions/exec";
import {info, endGroup, startGroup, warning, debug} from "@actions/core";
import {context} from "@actions/github";
import {inspect} from "util";
import type {GitHub} from "@actions/github/lib/utils";

const openerComment = '<!--DO NOT EDIT THE BLOCK BELOW THIS COMMENT-->';

const closerComment = '<!--DO NOT EDIT THE BLOCK ABOVE THIS COMMENT-->';

const regex = new RegExp(`\\s+(?:${openerComment}\\s*)?<details data-id="issue-marker">.*?\`\`\`yaml\\s+(?<yaml>.*?)\\s+\`\`\`.*?<\\/details>(?:\\s*${closerComment})?\\s+`, 'ims');

const issueRegex = /https:\/\/api\.github\.com\/repos\/(?<repository>.+?)\/issues\/\d+/;

export function getIssueMetadata (configuration: {stage: 'alpha'; body: string; version: string; commit: string; repository: string} | {stage: 'beta' | 'production'; body: string; version: string; commit: string}) {

    const { stage, body } = {...configuration};

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

    return { body: outputBody, commit };
}

function summarizeMetadata (metadata: string) {

    return `${openerComment}\n<details data-id="issue-marker">\n<summary>Issue Marker's Metadata</summary>\n\n\`\`\`yaml\n${metadata}\`\`\`\n</details>\n${closerComment}`;
}

export function getIssueRepository(issue: {url: string}) {

    const { repository } = issue.url.match(issueRegex)!.groups!;

    return repository;
}

async function getAllIssuesInOrganization(organizationName: string, octokit: InstanceType<typeof GitHub>) {

    let hasNextPage = true;
    let endCursor = null;
    let allIssues = [];

    while (hasNextPage) {
        const query = `
            query($orgName: String!, $endCursor: String) {
                organization(login: $orgName) {
                    repositories(first: 100, after: $endCursor) {
                        nodes {
                            issues(first: 100, labels: ["beta"], states: OPEN) {
                                nodes {
                                    repository {
                                        nameWithOwner
                                    }
                                    body
                                    number
                                }
                            }
                        }
                        pageInfo {
                            endCursor
                            hasNextPage
                        }
                    }
                }
            }
        `;

        const variables = {
            orgName: organizationName,
            endCursor,
        };

        const { organization } = (await octokit.graphql<{organization: string}>(query, variables));

        const repositories = organization.repositories.nodes;
        repositories.forEach((repo: any) => {
            const issues = repo.issues.edges.map((edge: any) => edge.node);
            allIssues = allIssues.concat(issues);
        });

        hasNextPage = organization.repositories.pageInfo.hasNextPage;
        endCursor = organization.repositories.pageInfo.endCursor;
    }

    return allIssues;
}

export async function getMarkedIssues(stage: 'beta' | 'production', octokit: InstanceType<typeof GitHub>) {

    const filterLabel = stage === 'production' ? 'beta' : 'alpha';

    const query = `"application: 'issue-marker'" AND "repository: '${context.repo.owner}/${context.repo.repo}'" type:issue state:open in:body label:${filterLabel}`;

    info(`Query: ${query}`);

    const items = (await octokit.rest.search.issuesAndPullRequests({ q: query })).data.items;

    info(`Items: ${inspect(items, {depth: 10})}`);

    const filteredItems = items.filter(item => item.body?.includes('application: \'issue-marker\'') &&

        item.body?.includes(`repository: '${context.repo.owner}/${context.repo.repo}'`) &&

        item.labels.map(label => label.name).includes(filterLabel) && item.state === 'open');

    info(`Filtered Items: ${inspect(filteredItems, {depth: 10})}`);

    return items;
}

export async function getTargetIssues(stage: 'alpha' | 'beta' | 'production', version: string, previousVersion: string, reference: string, octokit: InstanceType<typeof GitHub>): Promise<Array<{id: string; body: string; labels: Array<string>}>> {

    const logRegex = /^(?<hash>[0-9a-f]{40}) Merge pull request #(?<number>\d+) from .+?$/mg;

    const branchRegex = /^.+?\/(?<branch>[^\/\s]+)\s*$/mg;

    const linkRegex = /(?:(?<owner>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)\/(?<repo>[A-Za-z0-9-._]+))?#(?<issue>\d+)/ig;

    const issues = new Array<{id: string; body: string; labels: Array<string>}>();

    if (stage === 'alpha') {

        const logOutput = await getExecOutput('git', ['log', previousVersion ? `${previousVersion}...${version}` :

            version, '--reverse', '--merges', '--oneline', '--no-abbrev-commit']);

        if (logOutput.exitCode !== 0) throw new Error(logOutput.stderr);

        const log = logOutput.stdout;

        startGroup('Log Output');

        info(log);

        endGroup();

        const merges = [...(log.matchAll(logRegex) ?? [])].map(merge => ({hash: merge.groups!.hash!, number: +merge.groups!.number!}));

        if (merges.length === 0) {

            warning('No merges found.');

            return [];
        }

        const owner = context.repo.owner;

        const repo = context.repo.repo;

        startGroup('Repo Object');

        info(inspect(context.repo));

        endGroup();

        for (const merge of merges) {

            const pullRequest = (await octokit.rest.issues.get({ owner, repo, issue_number: merge.number })).data;

            const body = pullRequest.body ?? '';

            startGroup('PR Body');

            info(inspect(body));

            endGroup();

            const linkGroups = [...body.matchAll(linkRegex)].map(link => link.groups! as unknown as Link);

            startGroup('Link Groups');

            info(inspect(linkGroups));

            endGroup();

            const links = linkGroups

                .filter((link, i, all) => all.findIndex(l => `${link.owner?.toLowerCase() ?? owner}/${link.repo?.toLowerCase() ?? repo}#${link.issue}` === `${l.owner?.toLowerCase() ?? owner}/${l.repo?.toLowerCase() ?? repo}#${l.issue}`) === i);

            startGroup('Links');

            info(inspect(links));

            endGroup();

            for (const link of links) {

                const issue = (await octokit.rest.issues.get({ owner: link.owner ?? owner, repo: link.repo ?? repo, issue_number: +link.issue })).data;

                if (issue.state !== 'closed' && !issue.pull_request && issue.labels.every(label => ['beta', 'production'].every(stageLabel => (typeof(label) === 'string' ? label : label.name) ?? '' !== stageLabel))) {

                    const repository = getIssueRepository(issue);

                    issues.push({

                        id: `${repository}#${link.issue}`,

                        ...getIssueMetadata({stage, body: issue.body ?? '', commit: merge.hash, repository: `${owner}/${repo}`, version}),

                        labels: issue.labels.filter(label => typeof(label) === 'string' ? label : label.name)

                            .map(label => typeof(label) === 'string' ? label : label.name).filter(label => typeof(label) === 'string') as Array<string>
                    });
                }
            }
        }

    } else if (stage === 'production' || stage === 'beta') {

        const currentBranch = stage === 'production' ? 'main' : 'release';

        const items = await getMarkedIssues(stage, octokit);

        startGroup('Query Items');

        info(inspect(items));

        endGroup();

        for (const issue of items) {

            info(`Issue ${issue.repository}#${issue.number}`);

            const repository = getIssueRepository(issue);

            const {body, commit} = getIssueMetadata({stage, body: issue.body ?? '', version, commit: reference});

            startGroup('Issue Body');

            info(issue.body ?? '');

            endGroup();

            startGroup('Modified Body');

            info(body);

            endGroup();

            let error = '';

            let branches = '';

            try {

                await getExecOutput('git', ['branch', '-r', '--contains', commit], {listeners: {stderr: (data: Buffer) => error += data.toString(), stdout: (data: Buffer) => branches += data.toString()}});

                const labels = issue.labels.map(label => label.name ?? '').filter(label => label !== '');

                if ([...branches.matchAll(branchRegex)].map(branch => branch.groups!.branch).includes(currentBranch)) issues.push({
                    id: `${repository}#${issue.number}`,
                    body,
                    labels
                });

            } catch {

                warning(`Commit: ${commit}, Repository: ${issue.repository}#${issue.number}, Error: ${error}.`);
            }
        }
    }

    return issues;
}

export function deconstructIssueId(issue: {id: string; body: string; labels: Array<string>}): {owner: string; repo: string; number: string} {

    const idRegex = /^(?<owner>.+?)\/(?<repo>.+?)#(?<number>\d+)$/;

    return issue.id.match(idRegex)!.groups! as {owner: string; repo: string; number: string};
}

export function refineLabels(labels: Array<string>, body: string, stage: string): Array<string> {

    const testStageRegex = new RegExp(`^ *- +\\[x] +${stage} *$`, 'im');

    const needsTest = testStageRegex.test(body);

    return labels.filter(label => !['alpha', 'beta', 'production', 'test', 'approved'].includes(label)).concat([stage, ...(needsTest ? ['test'] : [])]);
}
