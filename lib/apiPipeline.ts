import * as cdk from "aws-cdk-lib";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecs from "aws-cdk-lib/aws-ecs";

import { Construct } from "constructs";

const DEFAULT_PLATFORM = "node_18";
const DEFAULT_BRANCH = "main";
const DEFAULT_ROOT_PATH = "apps/api";
const DEFAULT_INSTALL_CMD = "pnpm install";
const DEFAULT_BUILD_COMMAND = `turbo run build --filter="./apps/api`;
const DEFAULT_START_COMMAND = `node ./apps/api/dist/index.js`;
const DEFAULT_SCOPE = "api";
const DEFAULT_BUILD_IMAGE = codebuild.LinuxBuildImage.AMAZON_LINUX_2_4;

interface ApiPipelineResourcesProps extends cdk.NestedStackProps {
  repository: ecr.Repository;
  apiService: ecs_patterns.ApplicationLoadBalancedFargateService;
  dbCredentialsSecret: secretsmanager.Secret;
  container: ecs.ContainerDefinition;
  serviceId: string;
  config: {
    repositoryUrl: string;
    branch?: string | undefined | null;
    rootPath?: string | undefined | null;
    installCommand?: string | undefined | null;
    buildCommand?: string | undefined | null;
    startCommand?: string | undefined | null;
    turboScope?: string | undefined | null;
    platform?: string | undefined | null;
    buildImage?: codebuild.IBuildImage | undefined | null;
  };
}
export class ApiPipelineResources extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: ApiPipelineResourcesProps) {
    super(scope, id, props);

    const { repository, apiService, dbCredentialsSecret, container, config } =
      props;
    const [owner, repo] = config.repositoryUrl.split("/").slice(-2);
    const branch = config.branch || DEFAULT_BRANCH;
    const rootPath = config.rootPath || DEFAULT_ROOT_PATH;
    const installCmd = config.installCommand || DEFAULT_INSTALL_CMD;
    const buildCmd = config.buildCommand || DEFAULT_BUILD_COMMAND;
    const startCmd = config.startCommand || DEFAULT_START_COMMAND;
    const turboScope = config.turboScope || DEFAULT_SCOPE;
    const platform = config.platform || DEFAULT_PLATFORM;
    const buildImage = config.buildImage || DEFAULT_BUILD_IMAGE;

    // Setup CodePipeline
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: "GitHub_Source",
      owner, // Replace with your GitHub username
      repo, // Replace with your GitHub repo name
      oauthToken: cdk.SecretValue.secretsManager(
        `/stacks/${props.serviceId}/githubToken`
      ),
      output: sourceOutput,
      branch, // Replace with your GitHub branch
    });

    const buildArgs = [
      ["ROOT_PATH", rootPath],
      ["INSTALL_COMMAND", installCmd],
      ["BUILD_COMMAND", buildCmd],
      ["START_COMMAND", startCmd],
      ["SCOPE", turboScope],
    ]
      .map(([key, value]) => `--build-arg ${key}="${value}"`)
      .join(" ");

    const codebuildLogGroup = new logs.LogGroup(this, `CodeBuildLogGroup`, {
      logGroupName: `/services/${props.serviceId}/CodeBuild`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Setup build project
    const buildProject = new codebuild.PipelineProject(this, `${id}CodeBuild`, {
      logging: {
        cloudWatch: {
          enabled: true,
          logGroup: codebuildLogGroup,
          prefix: props.serviceId,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        env: {
          "secrets-manager": {
            DOCKERHUB_PASSWORD: "dockerhub/credentials:DOCKERHUB_PASSWORD",
            DOCKERHUB_USERNAME: "dockerhub/credentials:DOCKERHUB_USERNAME",
          },
        },
        phases: {
          pre_build: {
            commands: [
              "docker login --username $DOCKERHUB_USERNAME --password $DOCKERHUB_PASSWORD",
              `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com`,
              "IMAGE_TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}",
            ],
          },
          build: {
            commands: [
              `curl -fsSL https://raw.githubusercontent.com/protoxyz/platform-docker/main/dockerfiles/${platform}.Dockerfile >> Dockerfile`,
              `curl -fsSL https://raw.githubusercontent.com/protoxyz/platform-docker/main/dockerfiles/docker-entrypoint.sh >> docker-entrypoint.sh`,
              `chmod +x docker-entrypoint.sh`,
              `docker build ${buildArgs} -f Dockerfile -t $REPOSITORY_URI:latest .`,
              "docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG",
            ],
          },
          post_build: {
            commands: [
              "docker push $REPOSITORY_URI:latest",
              "docker push $REPOSITORY_URI:$IMAGE_TAG",
              `printf \'[{"name":"${container.containerName}","imageUri":"%s"}]\' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json`,
            ],
          },
        },
        artifacts: {
          files: "imagedefinitions.json",
        },
      }),
      environment: {
        privileged: true, // Required for Docker builds
        buildImage,
        environmentVariables: {
          AWS_ACCOUNT_ID: {
            value: this.account,
          },
          AWS_DEFAULT_REGION: {
            value: this.region,
          },
          REPOSITORY_URI: {
            value: repository.repositoryUri,
          },
        },
      },
    });

    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "secretsmanager:GetRandomPassword",
          "secretsmanager:GetResourcePolicy",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecretVersionIds",
        ],
        resources: [
          dbCredentialsSecret.secretArn,
          "arn:aws:secretsmanager:us-east-1:236720586719:secret:dockerhub/credentials-vIPh7u",
        ],
      })
    );

    repository.grantPullPush(buildProject);

    const buildOutput = new codepipeline.Artifact();

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: "DockerBuild",
      project: buildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: "AppDeployAction",
      service: apiService.service,
      imageFile: new codepipeline.ArtifactPath(
        buildOutput,
        `imagedefinitions.json`
      ),
    });

    const pipeline = new codepipeline.Pipeline(this, "MyPipeline", {
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Build",
          actions: [buildAction],
        },
        {
          stageName: "Deploy",
          actions: [deployAction],
        },
      ],
    });

    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecr:*"],
        resources: ["*"],
      })
    );

    // pipeline.addToRolePolicy(
    //     new iam.PolicyStatement({
    //         actions: ["ecr:*", "ecs:*"],
    //         resources: ["*"],
    //     }),
    // );

    pipeline.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:*", "ecs:*"],
        resources: ["*"],
      })
    );
  }
}
