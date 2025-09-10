import React from 'react';
import { Card, CardContent } from './ui\card';
import { motion } from "framer-motion";

export default function StatusCard({ 
  title, 
  value, 
  icon: Icon, 
  gradient = "meeting-gradient",
  delay = 0,
  subtitle,
  isLink = false 
}) {
  const gradientStyles = {
    'meeting-gradient': 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
    'whatsapp-gradient': 'linear-gradient(135deg, #4ADE80, #22C55E)',
    'bg-gray-400': '#9CA3AF',
    'bg-amber-500': '#F59E0B',
    'bg-green-500': '#10B981'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.1, duration: 0.5 }}
      whileHover={isLink ? { scale: 1.03 } : {}}
      style={{ height: '100%' }}
    >
      <Card className="glass-effect border-0 shadow-lg hover:shadow-xl transition-all-smooth" style={{ height: '100%' }}>
        <CardContent style={{ padding: '20px', height: '100%' }}>
          {/* DISEÑO VERTICAL SIEMPRE */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: '12px'
          }}>
            {/* Header con título e icono */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <p style={{
                fontSize: '14px',
                fontWeight: '500',
                color: '#6B7280',
                margin: 0,
                lineHeight: '1.25'
              }}>{title}</p>
              <div style={{
                width: '40px',
                height: '40px',
                background: gradientStyles[gradient] || gradientStyles['meeting-gradient'],
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                flexShrink: 0
              }}>
                <Icon style={{
                  width: '20px',
                  height: '20px',
                  color: 'white'
                }} />
              </div>
            </div>
            
            {/* Valor principal */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center'
            }}>
              <p style={{
                fontSize: '36px',
                fontWeight: '700',
                color: '#111827',
                margin: 0,
                lineHeight: '1'
              }}>{value}</p>
            </div>
            
            {/* Subtítulo opcional */}
            {subtitle && (
              <p style={{
                fontSize: '12px',
                fontWeight: '500',
                color: '#9CA3AF',
                margin: 0,
                lineHeight: '1.25'
              }}>{subtitle}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}