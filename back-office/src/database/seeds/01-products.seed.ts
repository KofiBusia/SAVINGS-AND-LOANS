/**
 * Seed: Loan and Savings Products
 * Ghana market-appropriate rates, all DCD 2025 compliant (simple interest, <= 36% p.a.)
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Seeding loan and savings products...");

  const products = [
    {
      name: "SME Working Capital Loan",
      targetSegment: "SME",
      minAmount: 5000,
      maxAmount: 100000,
      minTermMonths: 3,
      maxTermMonths: 36,
      annualInterestRatePercent: 24,  // 24% p.a. simple interest
      interestType: "SIMPLE",         // NEVER compound
      processingFeePercent: 1.5,
      penaltyRatePercent: 5,
      requiresCollateral: false,
      requiresGuarantor: true,
    },
    {
      name: "Microcredit Quick Loan",
      targetSegment: "MICROCREDIT",
      minAmount: 200,
      maxAmount: 5000,
      minTermMonths: 1,
      maxTermMonths: 12,
      annualInterestRatePercent: 30,  // 30% p.a. - within BoG cap
      interestType: "SIMPLE",
      processingFeePercent: 2,
      penaltyRatePercent: 5,
      requiresCollateral: false,
      requiresGuarantor: false,
    },
    {
      name: "Group Solidarity Loan",
      targetSegment: "GROUP",
      minAmount: 500,
      maxAmount: 20000,
      minTermMonths: 3,
      maxTermMonths: 24,
      annualInterestRatePercent: 22,  // Lower rate for group solidarity
      interestType: "SIMPLE",
      processingFeePercent: 1,
      penaltyRatePercent: 5,
      requiresCollateral: false,
      requiresGuarantor: true,
    },
    {
      name: "Agricultural Season Loan",
      targetSegment: "AGRICULTURAL",
      minAmount: 1000,
      maxAmount: 50000,
      minTermMonths: 6,
      maxTermMonths: 18,
      annualInterestRatePercent: 20,  // Lower rate for agriculture
      interestType: "SIMPLE",
      processingFeePercent: 1,
      penaltyRatePercent: 3,
      requiresCollateral: true,
      requiresGuarantor: false,
    },
  ];

  for (const product of products) {
    await prisma.loanProduct.upsert({
      where: { id: product.name },
      update: product,
      create: { ...product, id: undefined },
    });
    console.log(`  ✓ ${product.name} (${product.annualInterestRatePercent}% p.a. simple interest)`);
  }

  console.log("Products seeded successfully");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
