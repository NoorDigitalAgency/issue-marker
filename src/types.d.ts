export type Label = {
  name: string;
};

export type Issue = {
  body: string;
  closed: boolean;
  number: number;
  id: string;
  labels: {
    nodes: Array<Label>;
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
};

export type PullRequest = {
  number: number;
  title: string;
  closed: boolean;
  issues: {
    nodes: Array<Issue>;
  };
};

export type QueryData = {
  data: {
    repository: {
      pullRequest: PullRequest;
    };
  };
};