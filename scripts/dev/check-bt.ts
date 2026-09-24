import Stripe from "stripe";
async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const pi = await stripe.paymentIntents.retrieve("pi_3UJEbAFAcBoHeyB20HPQI8Ae", { expand: ["latest_charge.balance_transaction"] });
  const ch: any = pi.latest_charge;
  const bt = ch?.balance_transaction;
  console.log("charge:", ch?.id, "paid:", ch?.paid);
  console.log("balance txn status:", bt?.status, " available_on:", bt?.available_on ? new Date(bt.available_on*1000).toISOString() : "-", " net:", bt?.net);
  const bal = await stripe.balance.retrieve();
  console.log("available:", JSON.stringify(bal.available));
  console.log("pending  :", JSON.stringify(bal.pending));
}
main().catch(e => console.log("FAILED:", e.message?.slice(0,200)));
