import { normalizeCustomerName } from "./customer-name.js";
import { normalizeCustomerEmail } from "./customer-email.js";
import { normalizeCustomerWhatsapp } from "./customer-whatsapp.js";
export function normalizeCustomer(customer = {}) {
  return {
    name: normalizeCustomerName(customer.name),
    email: normalizeCustomerEmail(customer.email),
    whatsapp: normalizeCustomerWhatsapp(customer.whatsapp)
  };
}
