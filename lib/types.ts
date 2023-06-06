import * as cdk from "aws-cdk-lib";
import {
  Stack,
  StackResource,
  StackServiceEnvironmentVariable,
} from "@protoxyz/core";

export interface ProtocolStackProps extends cdk.StackProps {
  stackJSON: Stack;
  firstDeploy: boolean;
}

export type LinkedResources = {
  [key: string]: {
    stackResource: StackResource;
    resource: any;
    envVar: StackServiceEnvironmentVariable;
  };
};
