import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as certificates from "aws-cdk-lib/aws-certificatemanager";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";

import { Construct } from "constructs";
import { BaseResources } from "./base";
import { PostgresDatabaseResources } from "./postgres";
import { ApiResources } from "./api";
import { ApiPipelineResources } from "./apiPipeline";

interface ProtocolStackProps extends cdk.StackProps {
  stackJSON: any;
  firstDeploy: boolean;
}

export class ProtocolStack extends cdk.Stack {
  baseResources: BaseResources;
  postgresDatabases?: PostgresDatabaseResources[];
  apiResources?: ApiResources[];
  apiPipelineResources?: ApiPipelineResources[];

  constructor(scope: Construct, id: string, props: ProtocolStackProps) {
    super(scope, id, props);
    const stackConfiguration = props.stackJSON; //JSON.parse(props.stackJSON);

    console.log("firstDeploy", props.firstDeploy);
    console.log("stackConfiguration", stackConfiguration);

    // Base Resources
    this.baseResources = new BaseResources(this, "BaseResources");
    const { vpc, cluster, isolatedSubnetGroup } = this.baseResources;

    const postgresDatabases = stackConfiguration.resources.filter(
      (resource: any) => resource.type === "database_postgres"
    );

    if (postgresDatabases.length > 0) {
      this.postgresDatabases = postgresDatabases.map(
        (postgresDatabase: any) =>
          new PostgresDatabaseResources(this, "PostgresResources", {
            vpc,
            config: postgresDatabase.properties as any,
          })
      );
    }

    this.apiResources = [];
    this.apiPipelineResources = [];

    // TODO - need to add a type to services
    const apiServices = stackConfiguration.services;
    if (apiServices.length > 0) {
      apiServices.forEach((apiService: any) => {
        // TODO - this is a hack to get the first postgres database
        const linkedDb = this
          .postgresDatabases?.[0] as PostgresDatabaseResources;

        const api = new ApiResources(this, apiService.id, {
          cluster,
          postgres: linkedDb.postgres,
          dbCredentialsSecret: linkedDb.dbCredentialsSecret,
          firstDeploy: props.firstDeploy,
          stack: stackConfiguration,
          config: {},
        });

        api.addDependency(this.baseResources);
        api.addDependency(linkedDb);
        // api.addDependency(this.redisResources);
        this.apiResources?.push(api);

        // Pipeline
        const apiPipeline = new ApiPipelineResources(
          this,
          `${apiService.id}Pipeline`,
          {
            repository: api.repository,
            apiService: api.service,
            dbCredentialsSecret: linkedDb.dbCredentialsSecret,
            container: api.container,
            serviceId: apiService.id,
            config: {
              repositoryUrl: apiService.repository.repositoryUri,
              platform: apiService.platform,
              rootPath: apiService.path,
              installCommand: apiService.installCmd,
              buildCommand: apiService.buildCmd,
              startCommand: apiService.startCmd,
              // branch: apiService.repository.branch,
              // turboScope: apiService.turboScope,
              // buildImage: apiService.buildImage,
            },
          }
        );

        apiPipeline.addDependency(this.baseResources);
        apiPipeline.addDependency(linkedDb);
        apiPipeline.addDependency(api);

        this.apiPipelineResources?.push(apiPipeline);
      });
    }
  }
}
