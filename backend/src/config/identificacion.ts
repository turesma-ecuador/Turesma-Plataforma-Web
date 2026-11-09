export {};

const isValidCedula = (value: string) => {
  if (!/^\d{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (province < 1 || province > 24 || Number(value[2]) >= 6) return false;

  const sum = [...value.slice(0, 9)].reduce((total, digit, index) => {
    let product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    if (product > 9) product -= 9;
    return total + product;
  }, 0);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(value[9]);
};

const isValidRuc = (value: string) => {
  if (!/^\d{13}$/.test(value) || /^0+$/.test(value.slice(10))) return false;

  const province = Number(value.slice(0, 2));
  const thirdDigit = Number(value[2]);
  if (province < 1 || province > 24) return false;

  if (thirdDigit < 6) return isValidCedula(value.slice(0, 10));

  if (thirdDigit === 9) {
    const weights = [4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    const checkDigit = remainder === 0 ? 0 : 11 - remainder;
    return checkDigit === Number(value[9]);
  }

  if (thirdDigit === 6) {
    const weights = [3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    const checkDigit = remainder === 0 ? 0 : 11 - remainder;
    return checkDigit === Number(value[8]);
  }

  return false;
};

const normalizeIdentification = (type: unknown, value: unknown) => {
  const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
  const rawValue = typeof value === "string" ? value.trim() : "";
  const normalizedValue = normalizedType === "pasaporte"
    ? rawValue.replace(/[\s-]/g, "").toUpperCase()
    : rawValue.replace(/\s/g, "");

  if (!["cedula", "pasaporte", "ruc"].includes(normalizedType)) {
    return { type: null, value: null, error: "Selecciona un tipo de identificación válido" };
  }
  if (!normalizedValue) {
    return { type: normalizedType, value: null, error: "Ingresa el número de identificación" };
  }

  if (normalizedType === "cedula" && !isValidCedula(normalizedValue)) {
    return { type: null, value: null, error: "La cédula ecuatoriana no es válida" };
  }
  if (normalizedType === "pasaporte" && !/^[A-Z0-9]{5,20}$/.test(normalizedValue)) {
    return { type: null, value: null, error: "El pasaporte debe tener entre 5 y 20 letras o números" };
  }
  if (normalizedType === "ruc" && !isValidRuc(normalizedValue)) {
    return { type: null, value: null, error: "El RUC ecuatoriano no es válido" };
  }

  return { type: normalizedType, value: normalizedValue, error: null };
};

module.exports = { normalizeIdentification, isValidCedula, isValidRuc };
