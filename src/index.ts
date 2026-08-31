import { dispatch, type Registry } from "./cli/router.js";
import { homeCommand, rootHelp } from "./commands/home.js";
import { balanceCommand } from "./commands/balance.js";
import { chargesList, chargeDetail, chargeCapture } from "./commands/charges.js";
import { paymentsList, paymentDetail, paymentCapture, paymentCancel } from "./commands/payments.js";
import { customersList, customerDetail, customerAdd, customerRm } from "./commands/customers.js";
import { subscriptionsList, subscriptionDetail, subscriptionCancel } from "./commands/subscriptions.js";
import { invoicesList, invoiceDetail, invoiceVoid } from "./commands/invoices.js";
import { refundsList, refundCreate } from "./commands/refunds.js";
import { payoutsList, payoutDetail, payoutCreate } from "./commands/payouts.js";
import { productsList, productDetail, productUpdate } from "./commands/products.js";
import { pricesList, priceDetail, priceUpdate } from "./commands/prices.js";
import { eventsList, eventDetail } from "./commands/events.js";
import { disputesList, disputeDetail } from "./commands/disputes.js";
import { checkoutSessionsList } from "./commands/checkout.js";
import { paymentLinksList } from "./commands/payment-links.js";

// `stripe-axi charges --limit 100 | head -1` closes the pipe while a list
// write is still in flight. Without a listener Node turns that into an
// unhandled 'error' event: a stack trace on stderr and a non-zero exit for
// what was a successful read.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") throw err;
  process.exit(0);
});

const registry: Registry = {
  tool: "stripe-axi",
  root: homeCommand,
  rootHelp,
  commands: {
    balance: balanceCommand,
    charges: chargesList,
    charge: chargeDetail,
    "charge capture": chargeCapture,
    payments: paymentsList,
    payment: paymentDetail,
    "payment capture": paymentCapture,
    "payment cancel": paymentCancel,
    customers: customersList,
    customer: customerDetail,
    "customer add": customerAdd,
    "customer rm": customerRm,
    subscriptions: subscriptionsList,
    subscription: subscriptionDetail,
    "subscription cancel": subscriptionCancel,
    invoices: invoicesList,
    invoice: invoiceDetail,
    "invoice void": invoiceVoid,
    refunds: refundsList,
    refund: refundCreate,
    payouts: payoutsList,
    payout: payoutDetail,
    "payout create": payoutCreate,
    products: productsList,
    product: productDetail,
    "product update": productUpdate,
    prices: pricesList,
    price: priceDetail,
    "price update": priceUpdate,
    events: eventsList,
    event: eventDetail,
    disputes: disputesList,
    dispute: disputeDetail,
    "checkout sessions": checkoutSessionsList,
    "payment-links": paymentLinksList,
  },
  aliases: {},
};

// Not process.exit(): stdout writes to a pipe are asynchronous, and exiting
// immediately discards whatever is still buffered, truncating the document an
// agent is parsing. dispatch has already awaited everything, so setting the
// code lets the process exit as soon as stdout drains.
process.exitCode = await dispatch(registry, process.argv.slice(2));
