import fs = require("fs");
import cdk = require("@aws-cdk/core");
// import ssm = require("@aws-cdk/aws-ssm");
import iam = require("@aws-cdk/aws-iam");
import ec2 = require("@aws-cdk/aws-ec2");

function tap<T>(value: T, fn: (value: T) => void): T {
  fn(value);
  return value;
}

export class K3SStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // parameter store
    // stringValueは1文字以上必要（空文字列ではだめ）なのでダミーを入れておく
    // const host_param = new ssm.StringParameter(this, "SSMParamHost", {
    //   parameterName: "/k3s/master/host",
    //   stringValue: "127.0.0.1"
    // });
    // const token_param = new ssm.StringParameter(this, "SSMParamToken", {
    //   parameterName: "/k3s/master/token",
    //   stringValue: "some-token"
    // });

    // iam role for ec2
    const server_role = new iam.Role(this, "IAMRoleServer", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      inlinePolicies: {
        k3s_write_server_info: tap(new iam.PolicyDocument(), doc => {
          doc.addStatements(
            tap(new iam.PolicyStatement({ effect: iam.Effect.ALLOW }), st => {
              st.addActions("ssm:PutParameter");
              st.addResources("arn:aws:ssm:*:*:parameter/k3s/master/*");
            })
          );
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM")
      ]
    });
    const agent_role = new iam.Role(this, "IAMRoleAgent", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      inlinePolicies: {
        k3s_read_server_info: tap(new iam.PolicyDocument(), doc => {
          doc.addStatements(
            tap(new iam.PolicyStatement({ effect: iam.Effect.ALLOW }), st => {
              st.addActions("ssm:GetParameter");
              st.addResources("arn:aws:ssm:*:*:parameter/k3s/master/*");
            })
          );
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM")
      ]
    });

    // vpc / networks
    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: '10.0.0.0/22',
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: 'Ingress',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
        {
          name: 'Master',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
        {
          name: 'Worker',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ]
    })

    const secgroup = new ec2.SecurityGroup(this, 'SecurityGroup', { vpc })
    // TODO: rule

    // launch template with userdata
    const common_template_data: ec2.CfnLaunchTemplate.LaunchTemplateDataProperty = {
      instanceType: new ec2.InstanceType("t3.micro").toString(),
      imageId: new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2 }).getImage(this).imageId,
      networkInterfaces: [{
        associatePublicIpAddress: true,
        groups: [secgroup.securityGroupId],
      }],
      blockDeviceMappings: [{
        deviceName: '/dev/xvda',
        ebs: {
          deleteOnTermination: true,
          volumeSize: 8,
          volumeType: 'gp2'
        }
      }],
    }
    const master_template = new ec2.CfnLaunchTemplate(this, 'MasterTemplate', {
      launchTemplateData: Object.assign(common_template_data, {
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, 'InstanceProfileServer', {
            roles: [
              server_role.roleName
            ]
          }).attrArn
        },
        userData: fs.readFileSync('lib/userdata/master.sh').toString('base64')
      })
    })
    const agent_template = new ec2.CfnLaunchTemplate(this, 'AgentTemplate', {
      launchTemplateData: Object.assign(common_template_data, {
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, 'InstanceProfileAgent', {
            roles: [
              agent_role.roleName
            ]
          }).attrArn
        },
        userData: fs.readFileSync('lib/userdata/agent.sh').toString('base64')
      })
    })

    // autoscaling group
  }
}
