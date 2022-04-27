import { load, dump } from 'js-yaml';
import { Metadata } from './types';

export function getIssueMetadata (configuration: {stage: 'alpha'; labels: Array<string>; body: string; version: string; commit: string; repository: string} | {stage: 'beta' | 'production'; labels: Array<string>; body: string; version: string }) {

    const regex = /\s+(?:<!--.*?-->\s*)?<details data-id="issue-marker">.*?```yaml\s+(?<yaml>.*?)\s+```.*?<\/details>(?:\s*<!--.*?-->)?\s+/ims;

    const { stage, labels, body } = {...configuration};

    const metadataYaml = (body ?? '').match(regex)?.groups?.yaml;

    if (stage !== 'alpha' && !metadataYaml) {

        throw new Error();
    }

    const { commit, repository, version, history } = configuration.stage === 'alpha' ? {...configuration, history: [...(typeof(metadataYaml) === 'string' && metadataYaml !== '' ? {...load(metadataYaml) as Metadata}?.history ?? [] : []), {commit: configuration.commit, version: configuration.version}]} : {...load(metadataYaml!) as Metadata};

    const metadata = { application: 'issue-marker', repository, commit, version, history } as Metadata;

    const outputBody = `${regex.test(body) ? body.replace(regex, '\n\n') : body ?? ''}\n\n${summerizeMetadata(dump(metadata, {forceQuotes: true, quotingType: "'"}))}\n\n`;

    const outputLabels = labels.filter(label => !['alpha', 'beta', 'production'].includes(label)).concat([stage]);

    return { body: outputBody, labels: outputLabels, commit };
}

function summerizeMetadata (metadata: string) {

    return `<!--DO NOT EDIT THE BLOCK BELOW THIS COMMENT-->\n<details data-id="issue-marker">\n<summary>Issue Marker's Metadata</summary>\n\n\`\`\`yaml\n${metadata}\`\`\`\n</details>\n<!--DO NOT EDIT THE BLOCK ABOVE THIS COMMENT-->`;
}