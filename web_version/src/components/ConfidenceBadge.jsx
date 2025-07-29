import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

export default function ConfidenceBadge({ confidence, showIcon = true, size = "default" }) {
  const getConfidenceConfig = (confidence) => {
    if (confidence >= 90) {
      return {
        color: "bg-green-100 text-green-800 border-green-200",
        icon: CheckCircle,
        label: "High",
        labelEs: "Alta"
      };
    } else if (confidence >= 70) {
      return {
        color: "bg-yellow-100 text-yellow-800 border-yellow-200",
        icon: AlertTriangle,
        label: "Medium",
        labelEs: "Media"
      };
    } else {
      return {
        color: "bg-red-100 text-red-800 border-red-200",
        icon: XCircle,
        label: "Low",
        labelEs: "Baja"
      };
    }
  };

  const config = getConfidenceConfig(confidence);
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    default: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5"
  };

  return (
    <Badge className={`${config.color} border ${sizeClasses[size]} font-medium`}>
      {showIcon && <Icon className="w-3 h-3 mr-1" />}
      {confidence}%
    </Badge>
  );
}