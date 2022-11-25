import axios, {AxiosRequestConfig} from 'axios';
import {debug} from "@actions/core";
import type {GitHub} from "@actions/github/lib/utils";

export interface ZenHubColumn {
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

    private columns?: Array<ZenHubColumn>;

    constructor(private key: string, private workspaceId: string, private octokit: InstanceType<typeof GitHub>) {

        debug(`Workspace Id: ${workspaceId}`);
    }

    public async getColumns(): Promise<ZenHubColumn[]> {

        if (Array.isArray(this.columns)) {

            debugger;

            return this.columns;
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

        const columns = new Array<ZenHubColumn>();

        do {

            const variables = { id: this.workspaceId, cursor } as {id: string; cursor?: string};

            data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

            cursor = data?.workspace?.pipelinesConnection?.pageInfo?.endCursor;

            count = data?.workspace?.pipelinesConnection?.totalCount ?? 0;

            ((data?.workspace?.pipelinesConnection?.nodes ?? []) as Array<ZenHubColumn>).forEach(column => columns.push(column));

        } while (data?.workspace?.pipelinesConnection?.pageInfo?.hasNextPage === true);

        if (columns.length !== count) {

            throw new Error(`Expected ${count} columns but queried ${columns.length}.`);
        }

        this.columns = columns;

        return columns;
    }

    public async getColumn(name: string): Promise<ZenHubColumn> {

        const columns = await this.getColumns();

        const zenHubColumn = columns.find(column => column.name.toLowerCase() === name.toLowerCase());

        if (zenHubColumn == null) {

            throw new Error(`Column ${name} not found.`);
        }

        return zenHubColumn;
    }

    public async getColumnIssues(name: string): Promise<ZenHubIssue[]> {

        const column = await this.getColumn(name);

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

        const issues = new Array<ZenHubIssue>();

        do {

            const variables = { id: column.id, cursor } as {id: string; cursor?: string};

            data = (await axios.post(this.config.url!, { query, variables }, this.config)).data?.data;

            cursor = data?.searchIssuesByPipeline?.pageInfo?.endCursor;

            count = data?.searchIssuesByPipeline?.totalCount ?? 0;

            ((data?.searchIssuesByPipeline?.nodes ?? []) as Array<ZenHubIssue>).forEach(issue => issues.push(issue));

        } while (data?.searchIssuesByPipeline?.pageInfo?.hasNextPage === true);

        if (issues.length !== count) {

            throw new Error(`Expected ${count} issues but queried ${issues.length}.`);
        }

        return issues;
    }

    public async getGitHubRepositoryId(owner: string, repo: string) {

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

    public async getGitHubIssueId(owner: string, repo: string, number: number) {

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

        return data?.issueByInfo?.id;
    }
}
