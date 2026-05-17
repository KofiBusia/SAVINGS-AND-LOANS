/**
 * Seed: Test Customers with realistic Ghana data
 * DO NOT use in production - test/development only
 */

import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
const prisma = new PrismaClient();

const testCustomers = [
  {
    firstName: "Kwame",
    lastName: "Asante",
    region: "Greater Accra",
    district: "Accra Metropolitan",
    town: "Accra",
    phoneNumber: "+233244123456",
    ghanaCardSuffix: "12345678-3",
    riskClass: "LOW",
    kycStatus: "ACTIVE",
  },
  {
    firstName: "Abena",
    lastName: "Mensah",
    region: "Ashanti",
    district: "Kumasi Metropolitan",
    town: "Kumasi",
    phoneNumber: "+233554987654",
    ghanaCardSuffix: "87654321-2",
    riskClass: "LOW",
    kycStatus: "ACTIVE",
  },
  {
    firstName: "Kofi",
    lastName: "Boateng",
    region: "Western",
    district: "Sekondi-Takoradi Municipal",
    town: "Takoradi",
    phoneNumber: "+233264555888",
    ghanaCardSuffix: "11223344-7",
    riskClass: "MEDIUM",
    kycStatus: "ACTIVE",
  },
  {
    firstName: "Ama",
    lastName: "Owusu",
    region: "Eastern",
    district: "New Juaben Municipal",
    town: "Koforidua",
    phoneNumber: "+233271345678",
    ghanaCardSuffix: "99887766-1",
    riskClass: "LOW",
    kycStatus: "PENDING_ADDRESS",
  },
  {
    firstName: "Yaw",
    lastName: "Appiah",
    region: "Northern",
    district: "Tamale Metropolitan",
    town: "Tamale",
    phoneNumber: "+233242765432",
    ghanaCardSuffix: "44556677-5",
    riskClass: "HIGH",
    kycStatus: "PENDING_EDD",
  },
];

async function main() {
  console.log("Seeding test customers (dev only)...");

  for (const c of testCustomers) {
    const id = uuidv4();
    await prisma.customer.upsert({
      where: { ghanaCardHash: `mock-hash-${c.ghanaCardSuffix}` },
      update: {},
      create: {
        id,
        customerCode: `SL-TEST-${Date.now()}`,
        ghanaCardHash: `mock-hash-${c.ghanaCardSuffix}`,
        ghanaCardRecord: {
          cardNumber: `GHA-${c.ghanaCardSuffix}`,
          verificationMethod: "OCR_PLUS_NIA",
          livenessScore: 92,
          verifiedAt: new Date().toISOString(),
          niaReferenceCode: `NIA-TEST-${Date.now()}`,
        },
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: new Date("1985-06-15"),
        gender: "MALE",
        nationality: "GHA",
        phoneNumber: c.phoneNumber,
        region: c.region,
        district: c.district,
        town: c.town,
        streetAddress: `${Math.floor(Math.random() * 100) + 1} Main Street`,
        kycStatus: c.kycStatus,
        riskClass: c.riskClass,
        riskScore: c.riskClass === "LOW" ? 20 : c.riskClass === "MEDIUM" ? 50 : 80,
        cddNextReviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        accountNumber: `SL-2024-${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`,
        accountStatus: "ACTIVE",
        activatedAt: new Date(),
        pepScreening: { isPep: false, outcome: "CLEARED", screenedAt: new Date().toISOString() },
        dataProcessingConsentGiven: true,
        consents: [],
        createdBy: "SYSTEM_SEED",
      },
    });
    console.log(`  ✓ ${c.firstName} ${c.lastName} (${c.region}) - ${c.kycStatus}`);
  }

  console.log("Test customers seeded");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
