import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { t } from "../../utils/localLanguages";
import type { GhanaLanguage } from "../../utils/localLanguages";
import type { LoanProduct } from "../../../../shared/src/interfaces/Loan";
import { calculateSimpleInterest } from "../../../../shared/src/utils/interest";
import { DCD_2025 } from "../../../../shared/src/constants/compliance";

interface LoanApplicationWizardProps {
  customerId: string;
  availableProducts: LoanProduct[];
  language?: GhanaLanguage;
  onSubmit: (application: LoanApplicationData) => Promise<void>;
  onCancel: () => void;
}

interface LoanApplicationData {
  productId: string;
  amount: number;
  termMonths: number;
  purpose: string;
  preAgreementAcknowledged: boolean;
}

type WizardStep = "PRODUCT" | "AMOUNT" | "PURPOSE" | "PRE_AGREEMENT" | "REVIEW" | "SUBMITTED";

/**
 * Loan Application Wizard - DCD 2025 Compliant
 *
 * Step 1: Select loan product
 * Step 2: Enter amount and term
 * Step 3: Loan purpose
 * Step 4: Pre-agreement display (MANDATORY 30 seconds per DCD 2025)
 * Step 5: Review and submit with e-signature
 */
export function LoanApplicationWizard({
  customerId, availableProducts, language = "en", onSubmit, onCancel,
}: LoanApplicationWizardProps) {
  const [step, setStep] = useState<WizardStep>("PRODUCT");
  const [selectedProduct, setSelectedProduct] = useState<LoanProduct | null>(null);
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState(12);
  const [purpose, setPurpose] = useState("");
  const [preAgreementStartTime, setPreAgreementStartTime] = useState<Date | null>(null);
  const [preAgreementAcknowledged, setPreAgreementAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;

  const interestCalc = selectedProduct && parsedAmount > 0
    ? calculateSimpleInterest(parsedAmount, selectedProduct.annualInterestRatePercent, termMonths)
    : null;

  function handleProductSelect(product: LoanProduct): void {
    setSelectedProduct(product);
    setStep("AMOUNT");
  }

  function handleAmountNext(): void {
    if (parsedAmount < (selectedProduct?.minAmount ?? 0)) {
      Alert.alert("Invalid Amount", `Minimum loan amount is GH₵${selectedProduct?.minAmount}`);
      return;
    }
    if (parsedAmount > (selectedProduct?.maxAmount ?? 0)) {
      Alert.alert("Invalid Amount", `Maximum loan amount is GH₵${selectedProduct?.maxAmount}`);
      return;
    }
    setStep("PURPOSE");
  }

  function handlePurposeNext(): void {
    if (purpose.trim().length < 10) {
      Alert.alert("Purpose Required", "Please describe the purpose of this loan (minimum 10 characters)");
      return;
    }
    setPreAgreementStartTime(new Date());
    setStep("PRE_AGREEMENT");
  }

  function handlePreAgreementAck(): void {
    if (!preAgreementStartTime) return;
    const elapsed = (Date.now() - preAgreementStartTime.getTime()) / 1000;
    if (elapsed < DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS) {
      const remaining = Math.ceil(DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS - elapsed);
      Alert.alert(
        "Please Read Agreement",
        `Please read the pre-agreement for at least ${DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS} seconds ` +
        `before proceeding. ${remaining} seconds remaining. (BoG Digital Credit Directive 2025)`,
      );
      return;
    }
    setPreAgreementAcknowledged(true);
    setStep("REVIEW");
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedProduct || !preAgreementAcknowledged) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        productId: selectedProduct.id,
        amount: parsedAmount,
        termMonths,
        purpose,
        preAgreementAcknowledged: true,
      });
      setStep("SUBMITTED");
    } catch (error) {
      Alert.alert("Submission Failed", (error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <StepIndicator current={step} />
      <ScrollView style={styles.content}>
        {step === "PRODUCT" && (
          <View>
            <Text style={styles.stepTitle}>Select Loan Product</Text>
            {availableProducts.map((product) => (
              <TouchableOpacity key={product.id} style={styles.productCard} onPress={() => handleProductSelect(product)}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productDetail}>GH₵{product.minAmount.toLocaleString()} - GH₵{product.maxAmount.toLocaleString()}</Text>
                <Text style={styles.productDetail}>{product.annualInterestRatePercent}% p.a. | {product.minTermMonths}-{product.maxTermMonths} months</Text>
                <Text style={styles.complianceNote}>Simple interest only (BoG DCD 2025)</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {step === "AMOUNT" && selectedProduct && (
          <View>
            <Text style={styles.stepTitle}>Loan Amount & Term</Text>
            <Text style={styles.label}>Amount (GHS)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
              placeholder={`${selectedProduct.minAmount} - ${selectedProduct.maxAmount}`}
            />
            <Text style={styles.label}>Term: {termMonths} months</Text>
            <View style={styles.termButtons}>
              {[3, 6, 12, 18, 24, 36].filter(m => m >= selectedProduct.minTermMonths && m <= selectedProduct.maxTermMonths).map((m) => (
                <TouchableOpacity key={m} style={[styles.termBtn, termMonths === m && styles.termBtnActive]} onPress={() => setTermMonths(m)}>
                  <Text style={[styles.termBtnText, termMonths === m && styles.termBtnTextActive]}>{m}mo</Text>
                </TouchableOpacity>
              ))}
            </View>
            {interestCalc && (
              <View style={styles.calcBox}>
                <Text style={styles.calcTitle}>Loan Summary (Simple Interest)</Text>
                <Row label="Monthly Payment" value={`GH₵${interestCalc.monthlyInstalment.toFixed(2)}`} />
                <Row label="Total Interest" value={`GH₵${interestCalc.totalInterest.toFixed(2)}`} />
                <Row label="Total Repayment" value={`GH₵${interestCalc.totalRepayment.toFixed(2)}`} />
                <Row label="Interest Rate" value={`${selectedProduct.annualInterestRatePercent}% p.a.`} />
              </View>
            )}
            <TouchableOpacity style={styles.button} onPress={handleAmountNext}>
              <Text style={styles.buttonText}>{t("common.continue", language)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "PURPOSE" && (
          <View>
            <Text style={styles.stepTitle}>Loan Purpose</Text>
            <Text style={styles.label}>Describe how you will use this loan</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              numberOfLines={4}
              value={purpose}
              onChangeText={setPurpose}
              placeholder="E.g. Purchase inventory for my trading business..."
            />
            <TouchableOpacity style={styles.button} onPress={handlePurposeNext}>
              <Text style={styles.buttonText}>{t("common.continue", language)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "PRE_AGREEMENT" && interestCalc && selectedProduct && (
          <View>
            <Text style={styles.stepTitle}>Loan Pre-Agreement</Text>
            <Text style={styles.mandatoryNote}>⚠️ Please read this agreement carefully. You must read for at least {DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS} seconds. (Bank of Ghana DCD 2025)</Text>
            <View style={styles.agreementBox}>
              <Text style={styles.agreementText}>
                LOAN AGREEMENT - PRE-DISCLOSURE{"\n\n"}
                Lender: Ghana Savings & Loans Ltd{"\n"}
                Borrower: You (the applicant){"\n\n"}
                Loan Amount: GH₵{parsedAmount.toLocaleString()}{"\n"}
                Term: {termMonths} months{"\n"}
                Interest Rate: {selectedProduct.annualInterestRatePercent}% per annum (SIMPLE INTEREST){"\n"}
                Monthly Payment: GH₵{interestCalc.monthlyInstalment.toFixed(2)}{"\n"}
                Total Interest: GH₵{interestCalc.totalInterest.toFixed(2)}{"\n"}
                Total Repayable: GH₵{interestCalc.totalRepayment.toFixed(2)}{"\n\n"}
                IMPORTANT:{"\n"}
                • This loan uses SIMPLE interest only{"\n"}
                • No compounding interest applies{"\n"}
                • 24-hour cooling off period after signing{"\n"}
                • Complaints: contact us within 20 days{"\n"}
                • Late payments attract penalties{"\n"}
                • Your credit will be reported to XDS/D&B/MyCredit{"\n\n"}
                By proceeding, you confirm you have read and understood this agreement.
              </Text>
            </View>
            <TouchableOpacity style={styles.button} onPress={handlePreAgreementAck}>
              <Text style={styles.buttonText}>I have read and agree to proceed</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "REVIEW" && interestCalc && (
          <View>
            <Text style={styles.stepTitle}>Review & Submit</Text>
            <View style={styles.reviewBox}>
              <Row label="Product" value={selectedProduct?.name ?? ""} />
              <Row label="Amount" value={`GH₵${parsedAmount.toLocaleString()}`} />
              <Row label="Term" value={`${termMonths} months`} />
              <Row label="Monthly Payment" value={`GH₵${interestCalc.monthlyInstalment.toFixed(2)}`} />
              <Row label="Total Repayment" value={`GH₵${interestCalc.totalRepayment.toFixed(2)}`} />
              <Row label="Pre-Agreement" value="✓ Acknowledged" />
            </View>
            <TouchableOpacity style={[styles.button, isSubmitting && styles.disabledButton]} onPress={handleSubmit} disabled={isSubmitting}>
              <Text style={styles.buttonText}>{isSubmitting ? "Submitting..." : "Submit Application"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "SUBMITTED" && (
          <View style={styles.successContainer}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>Application Submitted!</Text>
            <Text style={styles.successText}>Your loan application has been received. You will be notified within 24-48 hours.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function StepIndicator({ current }: { current: WizardStep }) {
  const steps: WizardStep[] = ["PRODUCT", "AMOUNT", "PURPOSE", "PRE_AGREEMENT", "REVIEW"];
  const index = steps.indexOf(current);
  return (
    <View style={styles.stepIndicator}>
      {steps.map((s, i) => (
        <View key={s} style={[styles.stepDot, i <= index && styles.stepDotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { flex: 1, padding: 16 },
  stepTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 20, color: "#1a1a1a" },
  stepIndicator: { flexDirection: "row", justifyContent: "center", padding: 12, gap: 8, backgroundColor: "#fff" },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#ddd" },
  stepDotActive: { backgroundColor: "#007AFF" },
  productCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  productName: { fontSize: 17, fontWeight: "600", marginBottom: 4 },
  productDetail: { color: "#555", fontSize: 14, marginBottom: 2 },
  complianceNote: { color: "#007AFF", fontSize: 11, marginTop: 6 },
  label: { fontSize: 15, fontWeight: "500", marginBottom: 8, color: "#333" },
  input: { backgroundColor: "#fff", borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#e0e0e0", marginBottom: 16 },
  textarea: { height: 100, textAlignVertical: "top" },
  termButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  termBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#007AFF" },
  termBtnActive: { backgroundColor: "#007AFF" },
  termBtnText: { color: "#007AFF", fontWeight: "500" },
  termBtnTextActive: { color: "#fff" },
  calcBox: { backgroundColor: "#e8f4fd", borderRadius: 12, padding: 16, marginBottom: 20 },
  calcTitle: { fontWeight: "600", marginBottom: 10, color: "#0066cc" },
  button: { backgroundColor: "#007AFF", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8, marginBottom: 24 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  disabledButton: { opacity: 0.6 },
  mandatoryNote: { backgroundColor: "#fff3cd", borderRadius: 8, padding: 12, marginBottom: 12, color: "#856404", fontSize: 13 },
  agreementBox: { backgroundColor: "#fff", borderRadius: 8, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#ddd", maxHeight: 400 },
  agreementText: { fontSize: 13, lineHeight: 20, color: "#333" },
  reviewBox: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  rowLabel: { color: "#555", fontSize: 14 },
  rowValue: { fontWeight: "600", fontSize: 14 },
  successContainer: { alignItems: "center", paddingTop: 60 },
  successIcon: { fontSize: 72, marginBottom: 20 },
  successTitle: { fontSize: 24, fontWeight: "bold", marginBottom: 12 },
  successText: { fontSize: 16, color: "#555", textAlign: "center", paddingHorizontal: 20 },
});
