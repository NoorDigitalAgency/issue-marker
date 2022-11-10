import { load, dump } from 'js-yaml';
import { Metadata } from './types';

const openerComment = '<!--DO NOT EDIT THE BLOCK BELOW THIS COMMENT-->';

const closerComment = '<!--DO NOT EDIT THE BLOCK ABOVE THIS COMMENT-->';

const regex = new RegExp(`\\s+(?:${openerComment}\\s*)?<details data-id="issue-marker">.*?\`\`\`yaml\\s+(?<yaml>.*?)\\s+\`\`\`.*?<\\/details>(?:\\s*${closerComment})?\\s+`, 'ims');

export function getIssueMetadata (configuration: {stage: 'alpha'; labels: Array<string>; body: string; version: string; commit: string; repository: string} | {stage: 'beta' | 'production'; labels: Array<string>; body: string; version: string; commit: string}) {

    const { stage, labels, body } = {...configuration};

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

    const outputLabels = labels.filter(label => !['alpha', 'beta', 'production'].includes(label)).concat([stage]);

    return { body: outputBody, labels: outputLabels, commit };
}

function summarizeMetadata (metadata: string) {

    return `${openerComment}\n<details data-id="issue-marker">\n<summary>Issue Marker's Metadata</summary>\n\n\`\`\`yaml\n${metadata}\`\`\`\n</details>\n${closerComment}`;
}
