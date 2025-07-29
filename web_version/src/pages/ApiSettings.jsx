import React, { useState, useEffect } from "react";
import { ApiKey } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, Key, Trash2, Copy, Check } from "lucide-react";
import { motion } from "framer-motion";

export default function ApiSettings({ language = "en" }) {
  const [apiKeys, setApiKeys] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);

  const t = {
    en: {
      title: "API Key Management",
      description: "Generate and manage API keys for your B2B clients.",
      companyName: "Company Name",
      apiKey: "API Key",
      status: "Status",
      usage: "Usage",
      actions: "Actions",
      generate: "Generate New Key",
      revoke: "Revoke",
      active: "Active",
      inactive: "Inactive",
      revoked: "Revoked",
      noKeys: "No API keys found. Generate your first one to get started."
    },
    es: {
      title: "Gestión de Claves API",
      description: "Genera y gestiona las claves de API para tus clientes B2B.",
      companyName: "Nombre de la Empresa",
      apiKey: "Clave de API",
      status: "Estado",
      usage: "Uso",
      actions: "Acciones",
      generate: "Generar Nueva Clave",
      revoke: "Revocar",
      active: "Activa",
      inactive: "Inactiva",
      revoked: "Revocada",
      noKeys: "No se encontraron claves de API. Genera la primera para empezar."
    }
  };

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setIsLoading(true);
    const keys = await ApiKey.list("-created_date");
    setApiKeys(keys);
    setIsLoading(false);
  };

  const generateApiKey = async () => {
    if (!newCompanyName.trim()) {
      alert("Please enter a company name.");
      return;
    }
    setIsGenerating(true);
    const newKey = `mg_sk_${[...Array(32)].map(() => Math.random().toString(36)[2]).join('')}`;
    await ApiKey.create({
      key: newKey,
      company_name: newCompanyName
    });
    setNewCompanyName("");
    await loadApiKeys();
    setIsGenerating(false);
  };

  const revokeApiKey = async (id) => {
    if (confirm("Are you sure you want to revoke this key? This action cannot be undone.")) {
      await ApiKey.update(id, { status: "revoked" });
      await loadApiKeys();
    }
  };

  const copyToClipboard = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t[language].title}</h1>
          <p className="text-lg text-gray-600">{t[language].description}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Generate New API Key</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4">
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder={t[language].companyName}
              className="flex-grow p-2 border rounded-md"
            />
            <Button onClick={generateApiKey} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              <span className="ml-2">{t[language].generate}</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existing API Keys</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-24">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              </div>
            ) : apiKeys.length === 0 ? (
                <p className="text-center text-gray-500 py-8">{t[language].noKeys}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t[language].companyName}</TableHead>
                    <TableHead>{t[language].apiKey}</TableHead>
                    <TableHead>{t[language].status}</TableHead>
                    <TableHead>{t[language].usage}</TableHead>
                    <TableHead>{t[language].actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((apiKey) => (
                    <TableRow key={apiKey.id}>
                      <TableCell>{apiKey.company_name}</TableCell>
                      <TableCell className="font-mono flex items-center gap-2">
                        {`••••••••${apiKey.key.slice(-4)}`}
                        <Button variant="ghost" size="icon" onClick={() => copyToClipboard(apiKey.key)}>
                          {copiedKey === apiKey.key ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </TableCell>
                      <TableCell>{t[language][apiKey.status]}</TableCell>
                      <TableCell>{apiKey.usage_count}</TableCell>
                      <TableCell>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => revokeApiKey(apiKey.id)}
                          disabled={apiKey.status === 'revoked'}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          {t[language].revoke}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}