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
  postgresDatabases: { [key: string]: PostgresDatabaseResources };

  webServices: { [key: string]: WebService };
  webServicePipelines: { [key: string]: WebServicePipeline };

  constructor(scope: Construct, id: string, props: ProtocolStackProps) {
    super(scope, id, props);
    const stackConfiguration = props.stackJSON;

    console.log("firstDeploy", props.firstDeploy);
    console.log("stackConfiguration", stackConfiguration);

    // Base Resources
    console.log("Adding base resources");
    this.baseResources = new BaseResources(this, "Base");
    const { cluster, vpc } = this.baseResources;

    const postgresDatabases = stackConfiguration.resources.filter(
      (resource: any) => resource.type === "database_postgres"
    );

    console.log("Adding Postgres Databases");
    this.postgresDatabases = {};
    if (postgresDatabases.length > 0) {
      for (const postgresDatabase of postgresDatabases) {
        this.postgresDatabases[postgresDatabase.id] =
          new PostgresDatabaseResources(
            this,
            `${postgresDatabase.id}.Postgres`,
            {
              vpc,
              config: postgresDatabase.config as any,
            }
          );
      }
    }

    this.webServices = {};
    this.webServicePipelines = {};

    const webServices = stackConfiguration.services.filter(
      (service) => service.type === StackServiceType.web_server
    );

    console.log("Adding Web Services");
    for (const service of webServices) {
      let linkedResources = {} as LinkedResources;
      console.log(`Adding ${service.name}`);

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
                    resource: this.postgresDatabases[resource.id],
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
        service,
      });

      webService.addDependency(this.baseResources);
      for (const linkedResource in linkedResources) {
        webService.addDependency(linkedResources[linkedResource].resource);
      }
      this.webServices[service.id] = webService;

      console.log(`Adding ${service.name} Build Pipeline`);

      // Pipeline
      const pipeline = new WebServicePipeline(this, `${service.id}.Pipeline`, {
        repository: webService.repository,
        apiService: webService.service,
        container: webService.container,
        stackId: stackConfiguration.id,
        serviceId: service.id,
        config: {
          repositoryUrl: service.repository?.uri ?? "",
          ...service.buildConfig,
        },
      });

      pipeline.addDependency(this.baseResources);
      pipeline.addDependency(webService);

      this.webServicePipelines[service.id] = pipeline;
    }
  }
}
