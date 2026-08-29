import { validCustomerName } from "./customer-name.js";
import { validCustomerEmail } from "./customer-email.js";
import { validCustomerWhatsapp } from "./customer-whatsapp.js";
export function checkoutValidity(checkout = {}) {
  return {
    name: validCustomerName(checkout.name),
    email: validCustomerEmail(checkout.email),
    whatsapp: validCustomerWhatsapp(checkout.whatsapp)
  };
}
export function checkoutIsValid(checkout = {}) {
  return Object.values(checkoutValidity(checkout)).every(Boolean);
}
