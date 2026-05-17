# Ghana Savings & Loans - Terraform Infrastructure
# Target: Ghana-hosted cloud (Rack Centre / MainOne compatible)
# AWS af-south-1 (Cape Town) used as proxy - for true Ghana hosting,
# configure with local provider (MainOne/Rack Centre APIs)

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "s3" {
    bucket         = "ghana-savings-loans-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "ghana-sl-tfstate-lock"
  }
}

provider "aws" {
  region = "af-south-1"   # Cape Town - closest to Ghana, replace with Ghana local when available

  default_tags {
    tags = {
      Project     = "GhanaSavingsLoans"
      Environment = var.environment
      DataRegion  = "ghana"
      Compliance  = "BoG-DCD2025-AML1044-DPA843"
      ManagedBy   = "Terraform"
    }
  }
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

# VPC for Ghana Savings & Loans
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "ghana-sl-vpc-${var.environment}" }
}

# Public subnets (load balancers)
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "ghana-sl-public-${count.index}-${var.environment}" }
}

# Private subnets (application and database)
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "ghana-sl-private-${count.index}-${var.environment}" }
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "ghana-sl-igw" }
}

resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "ghana-sl-nat-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "ghana-sl-public-rt" }
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }
  tags = { Name = "ghana-sl-private-rt-${count.index}" }
}

# Security Group: Application
resource "aws_security_group" "app" {
  name        = "ghana-sl-app-sg"
  description = "Ghana Savings & Loans application security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 3001
    to_port     = 3002
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "Allow internal API traffic"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = { Name = "ghana-sl-app-sg" }
}

# Security Group: Database
resource "aws_security_group" "database" {
  name        = "ghana-sl-db-sg"
  description = "Database security group - only accepts from app tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
    description     = "PostgreSQL from app tier only"
  }

  tags = { Name = "ghana-sl-db-sg" }
}
