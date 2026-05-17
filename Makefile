.PHONY: setup dev test build lint seed bog-report backup deploy-staging deploy-prod help

# Ghana Savings & Loans Platform - Makefile
# Requires: Node.js 20+, Docker, Terraform, kubectl

SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show available commands
	@grep -E ''^[a-zA-Z_-]+:.*?## .*$$'' $(MAKEFILE_LIST) | awk ''BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}''

setup: ## Initial setup: install deps, generate keys, seed DB
	@echo "Setting up Ghana Savings & Loans platform..."
	@bash infrastructure/scripts/setup-ghana-env.sh
	cd shared && npm install
	cd back-office && npm install
	cd front-office && npm install
	cd mobile-app && npm install
	@echo "Running database migrations..."
	cd back-office && npx prisma migrate dev
	@echo "Seeding test data..."
	cd back-office && npx ts-node src/database/seeds/01-products.seed.ts
	cd back-office && npx ts-node src/database/seeds/02-roles.seed.ts
	cd back-office && npx ts-node src/database/seeds/03-test-customers.seed.ts
	@echo "Setup complete. Run: make dev"

dev: ## Start local development stack
	docker-compose up -d postgres redis minio ghipss-mock nia-mock
	@sleep 3
	cd back-office && npm run start:dev &
	cd front-office && npm run dev &
	@echo "Platform running:"
	@echo "  Back-office API: http://localhost:3001"
	@echo "  Front-office:    http://localhost:3000"
	@echo "  Swagger docs:    http://localhost:3001/api/docs"
	@echo "  Grafana:         http://localhost:3003"

dev-full: ## Start full stack including monitoring
	docker-compose up -d
	cd back-office && npm run start:dev &
	cd front-office && npm run dev

test: ## Run all tests (requires 90%+ compliance module coverage)
	cd shared && npm test
	cd back-office && npm run test:cov
	cd front-office && npm test
	cd mobile-app && npm test
	@echo "Running compliance tests (MUST pass for build)..."
	cd back-office && npm run test:compliance
	@echo "All tests passed"

test-compliance: ## Run Ghana regulatory compliance tests only
	cd back-office && npm run test:compliance
	cd shared && npm run test:compliance

test-integration: ## Run integration tests with mock servers
	docker-compose up -d ghipss-mock nia-mock
	cd back-office && npm run test:integration

test-e2e: ## Run end-to-end tests
	docker-compose up -d
	cd back-office && npm run test:e2e

test-load: ## Run k6 load test (Ghana peak traffic simulation)
	@which k6 > /dev/null || (echo "Install k6: https://k6.io" && exit 1)
	k6 run tests/load/k6-ghana-peak.js

lint: ## Lint and type-check all packages
	cd shared && npm run lint && npm run type-check
	cd back-office && npm run lint && npm run type-check
	cd front-office && npm run lint && npm run type-check
	cd mobile-app && npm run lint && npm run type-check

build: ## Build all packages for production
	cd shared && npm run build
	cd back-office && npm run build
	cd front-office && npm run build
	cd mobile-app && npm run build:android

seed: ## Seed development database with test data
	cd back-office && npx ts-node src/database/seeds/01-products.seed.ts
	cd back-office && npx ts-node src/database/seeds/02-roles.seed.ts
	cd back-office && npx ts-node src/database/seeds/03-test-customers.seed.ts

bog-report: ## Generate Bank of Ghana monthly report
	@read -p "Enter report month (YYYY-MM): " month; \
	cd infrastructure/scripts && npx ts-node generate-bog-report.ts --month=$$month

fic-report: ## Generate FIC STR/CTR report
	cd back-office && npx ts-node -e "require('./src/modules/compliance/fic-reporting.service').generatePendingReports()"

backup: ## Run encrypted backup to secondary Ghana location
	@bash infrastructure/scripts/backup-restore.sh backup

restore: ## Restore from latest backup (prompts for confirmation)
	@read -p "Restore from backup? This will overwrite current data. [y/N]: " confirm; \
	if [ "$$confirm" = "y" ]; then bash infrastructure/scripts/backup-restore.sh restore; fi

security-scan: ## Run security scan (SAST, dependency audit, secrets detection)
	npm audit --workspaces
	npx semgrep --config=p/typescript --config=p/nodejs .
	npx trufflehog git file://. --since-commit HEAD

deploy-staging: ## Deploy to staging environment
	@echo "Deploying to staging..."
	docker-compose -f infrastructure/docker/docker-compose.prod.yml build
	kubectl apply -f infrastructure/k8s/ --namespace=savings-loans-staging
	kubectl rollout status deployment/back-office -n savings-loans-staging

deploy-prod: ## Deploy to production (requires BoG checklist confirmation)
	@echo "=== BoG Pre-Deployment Checklist ==="
	@echo "1. All compliance tests passing? [y/N]"
	@read confirm1; if [ "$$confirm1" != "y" ]; then echo "Aborted"; exit 1; fi
	@echo "2. BoG notification filed (21 days)? [y/N]"
	@read confirm2; if [ "$$confirm2" != "y" ]; then echo "Aborted"; exit 1; fi
	@echo "3. Security assessment complete? [y/N]"
	@read confirm3; if [ "$$confirm3" != "y" ]; then echo "Aborted"; exit 1; fi
	@echo "Deploying to production..."
	kubectl apply -f infrastructure/k8s/ --namespace=savings-loans-prod
	kubectl rollout status deployment/back-office -n savings-loans-prod

clean: ## Clean all build artifacts and node_modules
	rm -rf shared/dist shared/node_modules
	rm -rf back-office/dist back-office/node_modules
	rm -rf front-office/.next front-office/node_modules
	rm -rf mobile-app/.expo mobile-app/node_modules
	docker-compose down -v
