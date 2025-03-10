import { Template } from '../../assertions';
import { App, Stack } from '../../core';

import {
  Connections,
  IConnectable,
  Port,
  SecurityGroup,
  Vpc,
} from '../lib';

describe('connections', () => {
  test('peering between two security groups does not recursive infinitely', () => {
    // GIVEN
    const stack = new Stack(undefined, 'TestStack', { env: { account: '12345678', region: 'dummy' } });

    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SG1', { vpc });
    const sg2 = new SecurityGroup(stack, 'SG2', { vpc });

    const conn1 = new SomethingConnectable(new Connections({ securityGroups: [sg1] }));
    const conn2 = new SomethingConnectable(new Connections({ securityGroups: [sg2] }));

    // WHEN
    conn1.connections.allowTo(conn2, Port.tcp(80), 'Test');

    // THEN -- it finishes!
  });

  test('(imported) SecurityGroup can be used as target of .allowTo()', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SomeSecurityGroup', { vpc, allowAllOutbound: false });
    const somethingConnectable = new SomethingConnectable(new Connections({ securityGroups: [sg1] }));

    const securityGroup = SecurityGroup.fromSecurityGroupId(stack, 'ImportedSG', 'sg-12345');

    // WHEN
    somethingConnectable.connections.allowTo(securityGroup, Port.allTcp(), 'Connect there');

    // THEN: rule to generated security group to connect to imported
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::GetAtt': ['SomeSecurityGroupEF219AD6', 'GroupId'] },
      IpProtocol: 'tcp',
      Description: 'Connect there',
      DestinationSecurityGroupId: 'sg-12345',
      FromPort: 0,
      ToPort: 65535,
    });

    // THEN: rule to imported security group to allow connections from generated
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      Description: 'Connect there',
      FromPort: 0,
      GroupId: 'sg-12345',
      SourceSecurityGroupId: { 'Fn::GetAtt': ['SomeSecurityGroupEF219AD6', 'GroupId'] },
      ToPort: 65535,
    });
  });

  test('security groups added to connections after rule still gets rule', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SecurityGroup1', { vpc, allowAllOutbound: false });
    const sg2 = new SecurityGroup(stack, 'SecurityGroup2', { vpc, allowAllOutbound: false });
    const connections = new Connections({ securityGroups: [sg1] });

    // WHEN
    connections.allowFromAnyIpv4(Port.tcp(88));
    connections.addSecurityGroup(sg2);

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Default/SecurityGroup1',
      SecurityGroupIngress: [
        {
          Description: 'from 0.0.0.0/0:88',
          CidrIp: '0.0.0.0/0',
          FromPort: 88,
          ToPort: 88,
          IpProtocol: 'tcp',
        },
      ],
    });

    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Default/SecurityGroup2',
      SecurityGroupIngress: [
        {
          Description: 'from 0.0.0.0/0:88',
          CidrIp: '0.0.0.0/0',
          FromPort: 88,
          ToPort: 88,
          IpProtocol: 'tcp',
        },
      ],
    });
  });

  test('when security groups are added to target they also get the rule', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SecurityGroup1', { vpc, allowAllOutbound: false });
    const sg2 = new SecurityGroup(stack, 'SecurityGroup2', { vpc, allowAllOutbound: false });
    const sg3 = new SecurityGroup(stack, 'SecurityGroup3', { vpc, allowAllOutbound: false });
    const connections1 = new Connections({ securityGroups: [sg1] });
    const connections2 = new Connections({ securityGroups: [sg2] });
    const connectable = new SomethingConnectable(connections2);

    // WHEN
    connections1.allowTo(connectable, Port.tcp(88));
    connections2.addSecurityGroup(sg3);

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SecurityGroup23BE86BB7', 'GroupId'] },
      SourceSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      FromPort: 88,
      ToPort: 88,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SecurityGroup3E5E374B9', 'GroupId'] },
      SourceSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      FromPort: 88,
      ToPort: 88,
    });
  });

  test('multiple security groups allows internally between them', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SecurityGroup1', { vpc, allowAllOutbound: false });
    const sg2 = new SecurityGroup(stack, 'SecurityGroup2', { vpc, allowAllOutbound: false });
    const connections = new Connections({ securityGroups: [sg1] });

    // WHEN
    connections.allowInternally(Port.tcp(88));
    connections.addSecurityGroup(sg2);

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      SourceSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      FromPort: 88,
      ToPort: 88,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      DestinationSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      GroupId: { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      FromPort: 88,
      ToPort: 88,
    });
  });

  test('can establish cross stack Security Group connections - allowFrom', () => {
    // GIVEN
    const app = new App();

    const stack1 = new Stack(app, 'Stack1');
    const vpc1 = new Vpc(stack1, 'VPC');
    const sg1 = new SecurityGroup(stack1, 'SecurityGroup', { vpc: vpc1, allowAllOutbound: false });

    const stack2 = new Stack(app, 'Stack2');
    const vpc2 = new Vpc(stack2, 'VPC');
    const sg2 = new SecurityGroup(stack2, 'SecurityGroup', { vpc: vpc2, allowAllOutbound: false });

    // WHEN
    sg2.connections.allowFrom(sg1, Port.tcp(100));

    // THEN -- both rules are in Stack2
    app.synth();

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
      SourceSecurityGroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09' },
    });

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09' },
      DestinationSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
    });
  });

  test('can establish cross stack Security Group connections - allowTo', () => {
    // GIVEN
    const app = new App();

    const stack1 = new Stack(app, 'Stack1');
    const vpc1 = new Vpc(stack1, 'VPC');
    const sg1 = new SecurityGroup(stack1, 'SecurityGroup', { vpc: vpc1, allowAllOutbound: false });

    const stack2 = new Stack(app, 'Stack2');
    const vpc2 = new Vpc(stack2, 'VPC');
    const sg2 = new SecurityGroup(stack2, 'SecurityGroup', { vpc: vpc2, allowAllOutbound: false });

    // WHEN
    sg2.connections.allowTo(sg1, Port.tcp(100));

    // THEN -- both rules are in Stack2
    app.synth();

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09' },
      SourceSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
    });

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
      DestinationSecurityGroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09' },
    });
  });

  test('can establish multiple cross-stack SGs', () => {
    // GIVEN
    const app = new App();

    const stack1 = new Stack(app, 'Stack1');
    const vpc1 = new Vpc(stack1, 'VPC');
    const sg1a = new SecurityGroup(stack1, 'SecurityGroupA', { vpc: vpc1, allowAllOutbound: false });
    const sg1b = new SecurityGroup(stack1, 'SecurityGroupB', { vpc: vpc1, allowAllOutbound: false });

    const stack2 = new Stack(app, 'Stack2');
    const vpc2 = new Vpc(stack2, 'VPC');
    const sg2 = new SecurityGroup(stack2, 'SecurityGroup', { vpc: vpc2, allowAllOutbound: false });

    // WHEN
    sg2.connections.allowFrom(sg1a, Port.tcp(100));
    sg2.connections.allowFrom(sg1b, Port.tcp(100));

    // THEN -- both egress rules are in Stack2
    app.synth();

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupAED40ADC5GroupId1D10C76A' },
      DestinationSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
    });

    Template.fromStack(stack2).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      GroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttSecurityGroupB04591F90GroupIdFA7208D5' },
      DestinationSecurityGroupId: { 'Fn::GetAtt': ['SecurityGroupDD263621', 'GroupId'] },
    });
  });
  test('Imported SecurityGroup does not create egress rule', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SomeSecurityGroup', { vpc, allowAllOutbound: false });
    const somethingConnectable = new SomethingConnectable(new Connections({ securityGroups: [sg1] }));

    const securityGroup = SecurityGroup.fromSecurityGroupId(stack, 'ImportedSG', 'sg-12345');

    // WHEN
    somethingConnectable.connections.allowFrom(securityGroup, Port.allTcp(), 'Connect there');

    // THEN: rule to generated security group to connect to imported
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SomeSecurityGroupEF219AD6', 'GroupId'] },
      IpProtocol: 'tcp',
      Description: 'Connect there',
      SourceSecurityGroupId: 'sg-12345',
      FromPort: 0,
      ToPort: 65535,
    });

    // THEN: rule to imported security group to allow connections from generated
    Template.fromStack(stack).resourceCountIs('AWS::EC2::SecurityGroupEgress', 0);
  });
  test('Imported SecurityGroup with allowAllOutbound: false DOES create egress rule', () => {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VPC');
    const sg1 = new SecurityGroup(stack, 'SomeSecurityGroup', { vpc, allowAllOutbound: false });
    const somethingConnectable = new SomethingConnectable(new Connections({ securityGroups: [sg1] }));

    const securityGroup = SecurityGroup.fromSecurityGroupId(stack, 'ImportedSG', 'sg-12345', {
      allowAllOutbound: false,
    });

    // WHEN
    somethingConnectable.connections.allowFrom(securityGroup, Port.allTcp(), 'Connect there');

    // THEN: rule to generated security group to connect to imported
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': ['SomeSecurityGroupEF219AD6', 'GroupId'] },
      IpProtocol: 'tcp',
      Description: 'Connect there',
      SourceSecurityGroupId: 'sg-12345',
      FromPort: 0,
      ToPort: 65535,
    });

    // THEN: rule to imported security group to allow connections from generated
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      IpProtocol: 'tcp',
      Description: 'Connect there',
      FromPort: 0,
      GroupId: 'sg-12345',
      DestinationSecurityGroupId: { 'Fn::GetAtt': ['SomeSecurityGroupEF219AD6', 'GroupId'] },
      ToPort: 65535,
    });
  });
});

class SomethingConnectable implements IConnectable {
  constructor(public readonly connections: Connections) {
  }
}
