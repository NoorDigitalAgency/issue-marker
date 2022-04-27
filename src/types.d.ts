export interface PullRequest {
  number: number;
  title: string;
  closed: boolean;
  issues: Nodes<Issue>;
}

export interface Issue {
  body: string;
  closed: boolean;
  number: number;
  repository: Repository;
  labels: Nodes<Label>;
}

export interface Repository {
  name: string;
  owner: Owner;
}

export interface Owner {
  login: string;
}

export interface Label {
  name: string;
}

export interface Nodes<T> {
  nodes: Array<T>;
}

export interface Metadata {
  application: string;
  repository: string;
  commit: string;
  version: string;
  history: Array<History>;
}

export interface History {
  commit: string;
  version: string;
}

export interface Link {
  owner: string;
  repo: string;
  issue: number;
}