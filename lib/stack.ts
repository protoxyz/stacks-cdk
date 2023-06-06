import * as cdk from "aws-cdk-lib";

import { Construct } from "constructs";
import { BaseResources } from "./base";
import { PostgresDatabaseResources } from "./postgres";
import { WebService } from "./webService";
import { WebServicePipeline } from "./webServicePipeline";
import {
  StackResource,
  StackResourceType,
  StackServiceType,
} from "@protoxyz/core";
import { LinkedResources, ProtocolStackProps } from "./types";

export class ProtocolStack extends cdk.Stack {
  baseResources: BaseResources;
  postgresDatabases?: PostgresDatabaseResources[];

  webServices?: WebService[];
  webServicePipelines?: WebServicePipeline[];

  constructor(scope: Construct, id: string, props: ProtocolStackProps) {
    super(scope, id, props);
    const stackConfiguration = props.stackJSON;

    console.log("firstDeploy", props.firstDeploy);
    console.log("stackConfiguration", stackConfiguration);

    // Base Resources
    this.baseResources = new BaseResources(this, "Base");
    const { cluster, vpc } = this.baseResources;

    const postgresDatabases = stackConfiguration.resources.filter(
      (resource: any) => resource.type === "database_postgres"
    );

    if (postgresDatabases.length > 0) {
      this.postgresDatabases = postgresDatabases.map(
        (postgresDatabase: any) =>
          new PostgresDatabaseResources(
            this,
            `${postgresDatabase.id}.Postgres`,
            {
              vpc,
              config: postgresDatabase.properties as any,
            }
          )
      );
    }

    this.webServices = [];
    this.webServicePipelines = [];

    const webServices = stackConfiguration.services.filter(
      (service) => service.type === StackServiceType.web_server
    );

    for (const service of webServices) {
      let linkedResources = {} as LinkedResources;

      for (const envVar of service.environment) {
        if (envVar.valueFrom) {
          const resource = stackConfiguration.resources.find(
            (resource) => resource.name === envVar.valueFrom
          );

          if (resource) {
            switch (resource.type) {
              case StackResourceType.database_postgres:
                {
                  linkedResources[envVar.valueFrom] = {
                    envVar,
                    stackResource: resource,
                    resource: this.postgresDatabases,
                  };
                }
                break;
            }

            // TODO - add more resource types
          }
        }
      }

      const webService = new WebService(this, `${service.id}.WebService`, {
        cluster,
        linkedResources,
        firstDeploy: props.firstDeploy,
        stack: stackConfiguration,
        config: service.config,
        environment: service.environment ?? [],
      });

      webService.addDependency(this.baseResources);
      for (const linkedResource in linkedResources) {
        webService.addDependency(linkedResources[linkedResource].resource);
      }
      this.webServices?.push(webService);

      // Pipeline
      const pipeline = new WebServicePipeline(this, `${service.id}.Pipeline`, {
        repository: webService.repository,
        apiService: webService.service,
        // dbCredentialsSecret: linkedDb.dbCredentialsSecret,
        container: webService.container,
        stackId: stackConfiguration.id,
        serviceId: service.id,
        config: {
          repositoryUrl: service.repository?.uri ?? "",
          ...service.buildConfig,
          // platform: apiService.platform,
          // rootPath: apiService.path,
          // installCommand: apiService.installCmd,
          // buildCommand: apiService.buildCmd,
          // startCommand: apiService.startCmd,
          // branch: apiService.repository.branch,
          // turboScope: apiService.turboScope,
          // buildImage: apiService.buildImage,
        },
      });

      pipeline.addDependency(this.baseResources);
      // pipeline.addDependency(linkedDb);
      pipeline.addDependency(webService);

      this.webServicePipelines?.push(pipeline);
    }

    webServices.forEach((service: any) => {
      // TODO - this is a hack to get the first postgres database
      const linkedDb = this.postgresDatabases?.[0] as PostgresDatabaseResources;
    });
  }
}
