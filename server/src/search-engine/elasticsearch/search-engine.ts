import * as Elasticsearch from 'elasticsearch';

import { SearchEngine, SearchEngineItem, SearchQuery, SearchResult } from '../../common/search-engine';
import { sleep } from '../../common/utils';
import { Converter } from './converter';

type ElasticsearchBulkResponse = { took: number, errors: boolean, items: { [key: string]: { [key: string]: any, status: number, error?: any } }[] };

export class ElasticsearchSearchEngine<T> implements SearchEngine<T> {
  private readonly indexName: string;
  private readonly typeName: string;
  private readonly client: Elasticsearch.Client;
  private readonly indexSettings: { [key: string]: any } | undefined;
  private readonly mapping: { [key: string]: any } | undefined;

  constructor(client: Elasticsearch.Client, indexName: string, typeName: string, indexSettings?: {}, indexMapping?: {}) {
    this.indexName = indexName;
    this.typeName = typeName;
    this.client = client;
    this.indexSettings = indexSettings;

    if (indexMapping != undefined) {
      this.mapping = {};
      this.mapping[typeName] = indexMapping;
    }
  }

  async initialize() {
    await this.waitForConnection();
    await this.ensureIndex();

    if (this.indexSettings != undefined || this.mapping != undefined) {
      await this.client.indices.close({ index: this.indexName });

      if (this.indexSettings != undefined) {
        await this.client.indices.putSettings({ index: this.indexName, body: this.indexSettings });
      }

      if (this.mapping != undefined) {
        await this.client.indices.putMapping({ index: this.indexName, type: this.typeName, body: this.mapping });
      }

      await this.client.indices.open({ index: this.indexName });
      await this.client.indices.refresh({ index: this.indexName });
    }
  }

  async index(items: SearchEngineItem<T>[]): Promise<void> {
    const bulkRequest = {
      body: [] as any[],
      index: this.indexName,
      type: this.typeName
    };

    for (const item of items) {
      bulkRequest.body.push(
        { index: { _id: item.id } },
        item.document
      );
    }

    const response = await this.client.bulk(bulkRequest) as ElasticsearchBulkResponse;

    if (response.errors) {
      throw new Error(JSON.stringify(response, null, 2));
    }
  }

  async search(query: SearchQuery): Promise<SearchResult<T>> {
    const elasticsearchQuery = Converter.convert(query, this.indexName, this.typeName);

    console.log(elasticsearchQuery);

    const result = await this.client.search<T>(elasticsearchQuery);

    const items = result.hits.hits.map((hit) => hit._source);

    const searchResult: SearchResult<T> = {
      total: result.hits.total,
      milliseconds: result.took,
      items: items
    };

    return searchResult;
  }

  async drop(): Promise<void> {
    await this.client.indices.delete({ index: this.indexName });
    await this.initialize();
  }

  private async ensureIndex() {
    const indexExists = await this.client.indices.exists({ index: this.indexName });

    if (!indexExists) {
      await this.client.indices.create({ index: this.indexName });
    }
  }

  private async waitForConnection(): Promise<void> {
    let success = false;

    do {
      try {
        await this.client.ping({ requestTimeout: 250 });
        success = true;
        console.log('connected to elasticsearch');
      } catch {
        console.log(`couldn't connect to elasticsearch, trying again...`)
      }

      await sleep(2000);
    } while (!success);
  }
}
