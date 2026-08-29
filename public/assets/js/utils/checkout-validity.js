import { validCustomerName } from "./customer-name.js";
import { validCustomerWhatsapp } from "./customer-whatsapp.js";
export function checkoutValidity(checkout = {}) {
  return {
    name: validCustomerName(checkout.name),
    whatsapp: validCustomerWhatsapp(checkout.whatsapp)
  };
}
export function checkoutIsValid(checkout = {}) {
  return Object.values(checkoutValidity(checkout)).every(Boolean);
}
