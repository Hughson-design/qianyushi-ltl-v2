// Keep unsupported selections from silently becoming cheaper, incomplete quotes.
export function serviceMappingIssue(provider: string, services: string[] = []) {
  const known = ["Liftgate at pickup", "Liftgate at delivery", "Residential pickup", "Residential delivery", "Limited access", "Appointment delivery", "Overlength freight"];
  if (services.some(service => !known.includes(service))) return "存在未支持的服务，请检查服务选项。 / Unsupported service selection; review the services.";
  if (services.includes("Overlength freight")) return "超长服务尚未完成计费对接，请联系管理员核实；本平台暂停此票报价。 / Overlength pricing requires assisted confirmation; this provider was skipped.";
  if (["tql", "wwex"].includes(provider) && services.includes("Residential delivery") && services.includes("Limited access")) return "无法同时传递住宅派送和限制性地址，请确认收货地址类型；其他支持的平台继续报价。 / Residential delivery and Limited access cannot both be represented by this provider; confirm the delivery location type.";
  if (provider === "tql" && services.includes("Residential pickup") && services.includes("Residential delivery")) return "TQL 不支持提货和收货两端均为住宅；其他平台继续报价。 / TQL does not support residential locations at both ends.";
  return null;
}
