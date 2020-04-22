#!/usr/bin/env node
import "source-map-support/register";
import cdk = require("@aws-cdk/core");
import { K3SStack } from "../lib/k3s-stack";

const app = new cdk.App();
new K3SStack(app, "K3SStack");
