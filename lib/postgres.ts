import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { Construct } from "constructs";

const DEFAULT_ENGINE_VERSION = rds.PostgresEngineVersion.VER_15_2;
const DEFAULT_INSTANCE_TYPE = ec2.InstanceType.of(
  ec2.InstanceClass.T3,
  ec2.InstanceSize.MICRO
);
const DEFAULT_MULTI_AZ = false;
const DEFAULT_ALLOCATED_STORAGE = 20;
const DEFAULT_STORAGE_TYPE = rds.StorageType.GP3;

interface PostgresDatabaseResourcesProps extends cdk.NestedStackProps {
  vpc: ec2.Vpc;
  config: {
    engineVersion: rds.PostgresEngineVersion;
    instanceType: ec2.InstanceType;
    multiAz: boolean;
    allocatedStorage: number;
    storageType: rds.StorageType;
    isPublic: boolean;
  };
}
export class PostgresDatabaseResources extends cdk.NestedStack {
  postgres: rds.DatabaseInstance;
  dbCredentialsSecret: secretsmanager.Secret;
  dbSecurityGroup: ec2.SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: PostgresDatabaseResourcesProps
  ) {
    super(scope, id, props);

    const { vpc, config } = props;

    const engineVersion = config.engineVersion ?? DEFAULT_ENGINE_VERSION;
    const instanceType = config.instanceType ?? DEFAULT_INSTANCE_TYPE;
    const multiAz = config.multiAz ?? DEFAULT_MULTI_AZ;
    const allocatedStorage =
      config.allocatedStorage ?? DEFAULT_ALLOCATED_STORAGE;
    const storageType = config.storageType ?? DEFAULT_STORAGE_TYPE;

    this.dbCredentialsSecret = new secretsmanager.Secret(this, "db-creds", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: "password",
        excludeCharacters: '"@/:',
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, "db-sg", {
      vpc,
    });

    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432)
    );

    this.postgres = new rds.DatabaseInstance(this, "db", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: engineVersion,
      }),
      credentials: rds.Credentials.fromSecret(this.dbCredentialsSecret),
      vpc,
      vpcSubnets: {
        subnetType: config.isPublic
          ? ec2.SubnetType.PUBLIC
          : ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.dbSecurityGroup],
      instanceType,
      multiAz,
      allocatedStorage,
      storageType,
      deletionProtection: false,
    });

    this.postgres.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432)
    );
  }
}
