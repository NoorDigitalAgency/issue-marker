export interface Metadata {
  application: string;
  repository: string;
  commit: string;
  version: string;
  history: Array<History>;
}

export interface History {
  version: string;
  commit: string;
}

export interface Link {
  owner: string;
  repo: string;
  issue: string;
}
