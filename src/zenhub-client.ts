import axios, {AxiosRequestConfig} from 'axios';
import * as core from "@actions/core";
import type {GitHub} from "@actions/github/lib/utils";
import {inspect} from "util";

export interface ZenHubPipeline {
    name: string;
    id: string;
}

export interface ZenHubIssue {
    title: string;
    id: string;
    number: number;
    ghId: number;
    repository: {
        name: string;
        ownerName: string;
    }
}

export class ZenHubClient {

    private config = {

        url: 'https://api.zenhub.com/public/graphql',

        headers: {

            Authorization: `Bearer ${this.key}`,

            ContentType: 'application/json',

            Accept: 'application/json'
        }

    } as AxiosRequestConfig;

    private pipelines?: Array<ZenHubPipeline>;

    public readonly enabled: boolean;

    constructor(private key: string, private workspaceId: string, private octokit: InstanceType<typeof GitHub>) {

        this.enabled = key !== '' && workspaceId !== '';

        core.info(`Enabled: ${this.enabled}`);

        if(this.enabled) {

            core.info(`Workspace Id: ${workspaceId}`);
        }
    }

    private updateWarning(warning: string, data: {errors?: Array<{message: string; path: string}>}) {

        if (data?.errors instanceof Array) {

            data.errors.map((error: {message: string; path: string}) => `${error.path}: ${error.message}`).forEach((message: string) => warning = `${(warning ? `${warning}\n` : '')}${message}`);
        }
    }

    public async getPipelines(): Promise<ZenHubPipeline[]> {

        if (Array.isArray(this.pipelines)) {

            return this.pipelines;
        }

        const query = `
            query workspacePipelines($id: ID!, $cursor: String) {
              workspace(id: $id){
                pipelinesConnection(after: $cursor, first: 50) {
                  nodes {
                    name
                    id
                  }
                  totalCount
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
        `;

        let data;

        let cursor = null;

        let count = 0;

        let warning = null as unknown as string;

        const pipelines = new Array<ZenHubPipeline>();

        let iteration = 0;

        do {

            const variables = { id: this.workspaceId, cursor } as {id: string; cursor?: string};

            data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

            this.updateWarning(warning, data);

            cursor = data?.workspace?.pipelinesConnection?.pageInfo?.endCursor;

            count = data?.workspace?.pipelinesConnection?.totalCount ?? 0;

            iteration++;

            core.startGroup(`Pipelines iteration #${iteration}`);

            core.info(inspect({

                payload: { query, variables },

                cursor,

                data
            }));

            core.endGroup();

            ((data?.workspace?.pipelinesConnection?.nodes ?? []) as Array<ZenHubPipeline>).forEach(pipeline => pipelines.push(pipeline));

        } while (data?.workspace?.pipelinesConnection?.pageInfo?.hasNextPage === true);

        if (warning != null) {

            core.warning(warning);
        }

        if (pipelines.length !== count) {

            throw new Error(`Expected ${count} pipelines but queried ${pipelines.length}.`);
        }

        this.pipelines = pipelines;

        return pipelines;
    }

    public async getPipeline(name: string): Promise<ZenHubPipeline> {

        const columns = await this.getPipelines();

        const zenHubColumn = columns.find(column => column.name.toLowerCase() === name.toLowerCase());

        if (zenHubColumn == null) {

            throw new Error(`Column ${name} not found.`);
        }

        return zenHubColumn;
    }

    public async getPipelineIssues(name: string): Promise<ZenHubIssue[]> {

        const pipeline = await this.getPipeline(name);

        const query = `
            query pipelineIssues($id: ID!, $cursor: String) {
              searchIssuesByPipeline(pipelineId: $id, after: $cursor, first: 50, filters: { displayType: issues }) {
                nodes {
                  title
                  id
                  number
                  ghId
                  repository {
                    name
                    ownerName
                  }
                }
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
        `;

        let data;

        let cursor = null;

        let count = 0;

        let warning = null as unknown as string;

        const issues = new Array<ZenHubIssue>();

        let iteration = 0;

        do {

            const variables = { id: pipeline.id, cursor } as {id: string; cursor?: string};

            data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

            this.updateWarning(warning, data);

            cursor = data?.searchIssuesByPipeline?.pageInfo?.endCursor;

            count = data?.searchIssuesByPipeline?.totalCount ?? 0;

            iteration++;

            core.startGroup(`Pipeline issues iteration #${iteration}`);

            core.info(inspect({

                payload: { query, variables },

                cursor,

                data
            }));

            core.endGroup();

            ((data?.searchIssuesByPipeline?.nodes ?? []) as Array<ZenHubIssue>).forEach(issue => issues.push(issue));

        } while (data?.searchIssuesByPipeline?.pageInfo?.hasNextPage === true);

        if (warning != null) {

            core.warning(warning);
        }

        if (issues.length !== count) {

            throw new Error(`Expected ${count} issues but queried ${issues.length}.`);
        }

        return issues;
    }

    public async getGitHubRepositoryId(owner: string, repo: string): Promise<number> {

        const response = (await this.octokit.graphql(`
            query repositoryId($owner: String!, $repo: String!) {
              organization(login: $owner){
                repository(name: $repo){
                  id
                }
              }
            }
        `, { owner, repo })) as { organization: { repository: { id: string } } };

        const base64 = response.organization.repository.id;

        return +(new Buffer(base64, 'base64').toString('ascii').split('010:Repository').pop() ?? '0');
    }

    public async getGitHubIssueId(owner: string, repo: string, number: number): Promise<string> {

        const id = await this.getGitHubRepositoryId(owner, repo);

        const query = `
            query issue($id: Int!, $number: Int!)
            {
              issueByInfo(repositoryGhId: $id, issueNumber: $number){
                id
              }
            }
        `;

        const variables = { id, number } as {id: number; number: number};

        const data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

        core.startGroup(`GitHub issue`);

        core.info(inspect({

            payload: { query, variables },

            data
        }));

        core.endGroup();

        let warning = null as unknown as string;

        this.updateWarning(warning, data);

        if (warning != null) {

            core.warning(warning);
        }

        return data?.issueByInfo?.id as string;
    }

    public async moveIssue(issue: string, pipeline: string): Promise<void> {

        const query = `
            mutation moveIssue($issue: ID!, $pipeline: ID!) {
              moveIssue(input: { issueId: $issue, pipelineId: $pipeline }) {
                clientMutationId
              }
            }
        `;

        const variables = { issue, pipeline } as {issue: string; pipeline: string};

        const data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

        core.startGroup(`Move issue`);

        core.info(inspect({

            payload: { query, variables },

            data
        }));

        core.endGroup();

        let warning = null as unknown as string;

        this.updateWarning(warning, data);

        if (warning != null) {

            core.warning(warning);
        }
    }

    public async moveGitHubIssue(owner: string, repo: string, number: number, pipeline: string): Promise<void> {

        const issueId = await this.getGitHubIssueId(owner, repo, number);

        const pipelineId = (await this.getPipeline(pipeline)).id;

        await this.moveIssue(issueId, pipelineId);
    }
}
