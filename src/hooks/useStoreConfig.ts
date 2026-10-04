import { useEffect, useState } from "react";
import { DEFAULT_STORE_CONFIG, fetchStoreConfig } from "../api/storeConfig";

// Configuração pública da loja (horário, endereço, WhatsApp...): começa nos valores padrão e troca pelos
// do servidor quando eles chegam.
export function useStoreConfig() {
  const [storeConfig, setStoreConfig] = useState(DEFAULT_STORE_CONFIG);

  useEffect(() => {
    let active = true;
    void fetchStoreConfig()
      .then(config => {
        if (active) setStoreConfig(config);
      })
      .catch(() => {
        // A home continua utilizável com os valores padrão se a configuração
        // pública estiver temporariamente indisponível.
      });

    return () => {
      active = false;
    };
  }, []);

  return storeConfig;
}
