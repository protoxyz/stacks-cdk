import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

import { Construct } from "constructs";

export class BaseResources extends cdk.NestedStack {
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  isolatedSubnets: cdk.aws_ec2.SelectedSubnets;
  privateSubnets: cdk.aws_ec2.SelectedSubnets;
  publicSubnets: cdk.aws_ec2.SelectedSubnets;
  isolatedSubnetGroup: elasticache.CfnSubnetGroup;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 3,
      natGateways: 1,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    this.cluster = new ecs.Cluster(this, "EcsCluster", { vpc: this.vpc });

    this.isolatedSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    });
    this.privateSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });
    this.publicSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    });

    this.isolatedSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "IsolatedSubnetGroup",
      {
        description: "Isolated subnet group",
        subnetIds: this.isolatedSubnets.subnetIds,
      }
    );
  }
}
