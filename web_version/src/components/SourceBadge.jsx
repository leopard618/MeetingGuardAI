import React from 'react';
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Bot, Brain, User } from "lucide-react";

export default function SourceBadge({ source, size = "default" }) {
  const getSourceConfig = (source) => {
    switch (source) {
      case "ChatGPT":
        return {
          color: "bg-purple-100 text-purple-800 border-purple-200",
          icon: Brain,
          label: "ChatGPT"
        };
      case "WhatsApp":
        return {
          color: "bg-green-100 text-green-800 border-green-200",
          icon: MessageCircle,
          label: "WhatsApp"
        };
      case "IA":
        return {
          color: "bg-orange-100 text-orange-800 border-orange-200",
          icon: Bot,
          label: "IA"
        };
      default:
        return {
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: User,
          label: "Manual"
        };
    }
  };

  const config = getSourceConfig(source);
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    default: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5"
  };

  return (
    <Badge className={`${config.color} border ${sizeClasses[size]} font-medium`}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}