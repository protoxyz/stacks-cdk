import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as certificates from "aws-cdk-lib/aws-certificatemanager";

import {
  Stack,
  StackResourceType,
  StackServiceEnvironmentVariable,
  StackWebServiceConfig,
} from "@protoxyz/core";
import { Construct } from "constructs";
import { LinkedResources } from "./types";

const DEFAULT_CPU = 256;
const DEFAULT_MEMORY_LIMIT_MIB = 512;
const DEFAULT_DESIRED_COUNT = 1;
const DEFAULT_SCALING_MIN = 1;
const DEFAULT_SCALING_MAX = 1;
const DEFAULT_CPU_SCALING_TARGET_PERCENT = 50;
const DEFAULT_CPU_SCALING_COOLDOWN_IN = 60;
const DEFAULT_CPU_SCALING_COOLDOWN_OUT = 60;
const DEFAULT_MEMORY_SCALING_TARGET_PERCENT = 50;
const DEFAULT_MEMORY_SCALING_COOLDOWN_IN = 60;
const DEFAULT_MEMORY_SCALING_COOLDOWN_OUT = 60;
const DEFAULT_CONTAINER_PORT = "4000";

interface WebServiceProps extends cdk.NestedStackProps {
  cluster: ecs.Cluster;
  // postgres: rds.DatabaseInstance;
  // dbCredentialsSecret: secretsmanager.ISecret;
  linkedResources: LinkedResources;
  firstDeploy: boolean;
  stack: Stack;
  environment: StackServiceEnvironmentVariable[];
  config: StackWebServiceConfig;
}
export class WebService extends cdk.NestedStack {
  repository: ecr.Repository;
  logging: ecs.AwsLogDriver;
  taskDefinition: ecs.FargateTaskDefinition;
  container: ecs.ContainerDefinition;
  service: ecs_patterns.ApplicationLoadBalancedFargateService;
  route53Record: route53.ARecord;
  // serviceSecrets: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: WebServiceProps) {
    super(scope, id, props);
    const { cluster, config, linkedResources } = props;

    console.log("WEB SERVICE CONFIG", config);

    this.repository = new ecr.Repository(this, `${id}.Repository`, {
      autoDeleteImages: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // create a task definition with CloudWatch Logs
    this.logging = new ecs.AwsLogDriver({
      streamPrefix: id,
    });

    const port = config.port ?? DEFAULT_CONTAINER_PORT;
    const cpu = config.cpu ?? DEFAULT_CPU;
    const memoryLimitMiB = config.memory ?? DEFAULT_MEMORY_LIMIT_MIB;
    const desiredCount = config.desiredCount ?? DEFAULT_DESIRED_COUNT;
    const minCapacity = config.minCapacity ?? DEFAULT_SCALING_MIN;
    const maxCapacity = config.maxCapacity ?? DEFAULT_SCALING_MAX;
    const cpuScalingTargetPercent =
      config.cpuScalingTargetPercent ?? DEFAULT_CPU_SCALING_TARGET_PERCENT;
    const cpuScalingCooldownIn =
      config.cpuScalingCooldownIn ?? DEFAULT_CPU_SCALING_COOLDOWN_IN;
    const cpuScalingCooldownOut =
      config.cpuScalingCooldownOut ?? DEFAULT_CPU_SCALING_COOLDOWN_OUT;
    const memoryScalingTargetPercent =
      config.memoryScalingTargetPercent ??
      DEFAULT_MEMORY_SCALING_TARGET_PERCENT;
    const memoryScalingCooldownIn =
      config.memoryScalingCooldownIn ?? DEFAULT_MEMORY_SCALING_COOLDOWN_IN;
    const memoryScalingCooldownOut =
      config.memoryScalingCooldownOut ?? DEFAULT_MEMORY_SCALING_COOLDOWN_OUT;

    // Define the ECS Task Definition with a single container. The Docker image for the container will be pulled from DockerHub.
    this.taskDefinition = new ecs.FargateTaskDefinition(this, `${id}Task`, {
      cpu,
      memoryLimitMiB,
    });

    // this.serviceSecrets = new secretsmanager.Secret(this, `${id}Secrets`, {
    //   secretName: `/services/${id}/secrets/production`,
    // });

    // const pxyzApiSecrets = secretsmanager.Secret.fromSecretCompleteArn(
    //     this,
    //     "pxyzApiSecrets",
    //     "arn:aws:secretsmanager:us-east-1:236720586719:secret:pxyz-api-3FHvVh",
    // );

    const pxyzCloudCertificate = certificates.Certificate.fromCertificateArn(
      this,
      "pxyzCloudCertificate",
      "arn:aws:acm:us-east-1:236720586719:certificate/d05dc809-6b1d-48b4-9e1f-3ac45ed2c211"
    );

    const pxyzCloudZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "pxyzCloudZone",
      {
        hostedZoneId: "Z024477010JF92LV7QKHW",
        zoneName: "pxyz.cloud",
      }
    );

    const firstDeployRepository = ecr.Repository.fromRepositoryName(
      this,
      "firstDeployRepository",
      "pxyz-hello-world"
    );

    let linkedResourceSecrets = {} as { [key: string]: ecs.Secret };
    let linkedResourceEnvVars = {} as { [key: string]: string };

    for (const key in linkedResources) {
      const linkedResource = linkedResources[key];

      switch (linkedResource.stackResource.type) {
        case StackResourceType.database_postgres:
          {
            const creds = linkedResource.resource.creds;

            console.log("creds", creds);

            linkedResourceSecrets[`${linkedResource.envVar.key}_DB_USERNAME`] =
              ecs.Secret.fromSecretsManager(creds, "username");
            linkedResourceSecrets[`${linkedResource.envVar.key}_DB_PASSWORD`] =
              ecs.Secret.fromSecretsManager(creds, "password");

            linkedResourceEnvVars[`${linkedResource.envVar.key}_DB_HOST`] =
              linkedResource.resource.postgres.instanceEndpoint.hostname;
            linkedResourceEnvVars[`${linkedResource.envVar.key}_DB_PORT`] =
              linkedResource.resource.postgres.instanceEndpoint.port.toString();
            linkedResourceEnvVars[`${linkedResource.envVar.key}_DB_NAME`] =
              linkedResource.resource.postgres.instanceIdentifier;
          }
          break;
        case StackResourceType.cache_redis:
          {
            linkedResourceEnvVars[`${linkedResource.envVar.key}_REDIS_HOST`] =
              linkedResource.resource.attrRedisEndpointAddress;
            linkedResourceEnvVars[`${linkedResource.envVar.key}_REDIS_PORT`] =
              linkedResource.resource.attrRedisEndpointPort;
          }
          break;
      }
    }

    this.container = this.taskDefinition.addContainer(`${id}Container`, {
      memoryLimitMiB,
      image: props.firstDeploy
        ? ecs.ContainerImage.fromEcrRepository(firstDeployRepository)
        : ecs.ContainerImage.fromEcrRepository(this.repository),

      secrets: {
        ...linkedResourceSecrets,
      },
      environment: {
        NODE_ENV: "production",
        PROTOCOL_ENV: "production",

        PROTOCOL_ORGANIZATION_ID: props.stack.project?.organization?.id ?? "",
        PROTOCOL_ORGANIZATION_NAME:
          props.stack.project?.organization?.name ?? "",
        PROTOCOL_PROJECT_ID: props.stack.project?.id ?? "",
        PROTOCOL_PROJECT_NAME: props.stack.project?.name ?? "",
        PROTOCOL_STACK_ID: props.stack.id ?? "",
        PROTOCOL_STACK_NAME: props.stack.name ?? "",

        ...linkedResourceEnvVars,

        PORT: port.toString(),
      },
      logging: this.logging,
    });

    this.container.addPortMappings({
      containerPort: parseInt(port.toString()),
      protocol: ecs.Protocol.TCP,
    });

    // Instantiate FargateService with just cluster and task definition
    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      `${id}Service`,
      {
        cluster,
        certificate: pxyzCloudCertificate,
        taskDefinition: this.taskDefinition,
        desiredCount,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      }
    );

    const scaling = this.service.service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: cpuScalingTargetPercent,
      scaleInCooldown: cdk.Duration.seconds(cpuScalingCooldownIn),
      scaleOutCooldown: cdk.Duration.seconds(cpuScalingCooldownOut),
    });

    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: memoryScalingTargetPercent,
      scaleInCooldown: cdk.Duration.seconds(memoryScalingCooldownIn),
      scaleOutCooldown: cdk.Duration.seconds(memoryScalingCooldownOut),
    });

    // Create an alias record for the load balancer
    this.route53Record = new route53.ARecord(this, "AliasRecord", {
      zone: pxyzCloudZone,
      recordName: `${id}`,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.LoadBalancerTarget(this.service.loadBalancer)
      ),
      ttl: cdk.Duration.minutes(1),
    });

    // this.service.targetGroup.configureHealthCheck({
    //     path: "/",
    //     port: "4000",
    //     interval: cdk.Duration.seconds(5),
    //     timeout: cdk.Duration.seconds(4),
    //     healthyThresholdCount: 2,
    //     unhealthyThresholdCount: 2,
    //     healthyHttpCodes: "200,301,302",
    // });
  }
}
