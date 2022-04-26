export type PullRequest = {
  number: number;
  title: string;
  closed: boolean;
  issues: Nodes<Issue>;
};

export type Issue = {
  body: string;
  closed: boolean;
  number: number;
  repository: Repository;
  labels: Nodes<Label>;
};

export type Repository = {
  name: string;
  owner: Owner;
}

export type Owner = {
  login: string;
}

export type Label = {
  name: string;
};

export type Nodes<T> = {
  nodes: Array<T>;
}