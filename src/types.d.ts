export type Label = {
  name: string;
};

export type Issue = {
  body: string;
  closed: boolean;
  number: number;
  labels: {
    nodes: Array<Label>;
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