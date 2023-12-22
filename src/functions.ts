import { load, dump } from 'js-yaml';
import {Link, Metadata} from './types';
import {getExecOutput} from "@actions/exec";
import {info, endGroup, startGroup, warning} from "@actions/core";
import {context} from "@actions/github";
import {inspect} from "util";
import type {GitHub} from "@actions/github/lib/utils";
import type {
    Issue,
    IssueConnection,
    Organization,
    Repository,
    RepositoryConnection
} from "@octokit/graphql-schema";

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

async function getAllIssuesInOrganization(octokit: InstanceType<typeof GitHub>, labels: Array<string>) {

    let hasNextPage = true;
    
    let endCursor = null;

    const targetRepositories = new Array<{owner: string; name: string}>();

    while (hasNextPage) {

        const query = `
                query($organizationName: String!, $endCursor: String, $labels: [String!]) {
                    organization(login: $organizationName) {
                        repositories(first: 100, after: $endCursor) {
                            nodes {
                                issues(labels: $labels, states: OPEN) {
                                    totalCount
                                }
                                name
                                owner {
                                  login
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

        const repositories = (await octokit.graphql<{organization: Organization}>(query, {organizationName: context.repo.owner, endCursor, labels })).organization.repositories as RepositoryConnection;

        if (repositories.nodes && repositories.nodes.length > 0) {

            targetRepositories.push(...repositories.nodes.filter(node => node?.issues.totalCount ?? 0 > 0).map(node => ({owner: node!.owner.login, name: node!.name})));
        }

        hasNextPage = repositories?.pageInfo.hasNextPage;

        endCursor = repositories?.pageInfo.endCursor;
    }

    const targetIssues = new Array<Issue>();

    for (const targetRepository of targetRepositories) {

        hasNextPage = true;

        endCursor = null;

        while (hasNextPage) {

            const query = `
                query($owner: String!, $name: String!, $endCursor: String, $labels: [String!]) {
                    repository(owner: $owner, name: $name) {
                        issues(first: 100, after: $endCursor, labels: $labels, states: OPEN) {
                            nodes {
                                number
                                body
                                repository {
                                    name
                                    owner {
                                        login
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

            const issues = (await octokit.graphql<{repository: Repository}>(query, {owner: targetRepository.owner, name: targetRepository.name, endCursor, labels})).repository.issues as IssueConnection;

            if (issues?.nodes && issues.nodes.length > 0) {

                targetIssues.push(...issues.nodes.map(issue => issue as Issue));
            }

            hasNextPage = issues?.pageInfo.hasNextPage;

            endCursor = issues?.pageInfo.endCursor;
        }
    }

    return targetIssues;
}

export async function getMarkedIssues(stage: 'beta' | 'production', octokit: InstanceType<typeof GitHub>) {

    const filterLabel = stage === 'production' ? 'beta' : 'alpha';

    const contains = dump({ application: 'issue-marker', repository: `${context.repo.owner}/${context.repo.repo}` }).trim();

    info(`Contains: "${contains}"`);

    const issues = (await getAllIssuesInOrganization(octokit, [filterLabel])).filter(issue => issue.body.includes(contains));

    startGroup('Issues');

    info(inspect(issues, {depth: 10}));

    endGroup();

    return issues;
}

export function getIssueRepository(issue: Issue) {

    return issue.repository && issue.repository.owner ? `${issue.repository?.owner?.login}/${issue.repository?.name}` : '';
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

                    const repository = `${issue.repository!.owner}/${issue.repository!.name}`;

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

        for (const issue of items) {

            const repository = getIssueRepository(issue);

            info(`Issue ${repository}#${issue.number}`);

            const {body, commit} = getIssueMetadata({stage, body: issue.body ?? '', version, commit: reference});

            startGroup('Issue Body');

            info(body);

            endGroup();

            startGroup('Modified Body');

            info(body);

            endGroup();

            let error = '';

            let branches = '';

            try {

                await getExecOutput('git', ['branch', '-r', '--contains', commit], {listeners: {stderr: (data: Buffer) => error += data.toString(), stdout: (data: Buffer) => branches += data.toString()}});

                const labels = issue.labels?.nodes?.map(label => label?.name ?? '').filter(label => label !== '') ?? [];

                if ([...branches.matchAll(branchRegex)].map(branch => branch.groups!.branch).includes(currentBranch)) issues.push({
                    id: `${repository}#${issue.number}`,
                    body,
                    labels
                });

            } catch {

                warning(`Commit: ${commit}, Repository: ${repository}#${issue.number}, Error: ${error}.`);
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
