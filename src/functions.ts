import { load, dump } from 'js-yaml';

export function getIssueMetadata (stage: string, labels: Array<string>, body: string, hash?: string, repository?: string) {

    const regex = /\s+<details data-id="issue-marker">.*?```yaml\s+(?<yaml>.*?)\s+```.*?<\/details>\s+/ms;

    return { body: '', labels: []};
}