import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  ActivityIndicator,
  Chip,
  ProgressBar,
} from 'react-native-paper';
import { MaterialIcons } from '@expo/vector-icons';
import aiService from '@/api/aiService';

export default function AIOptimizer({ meetings, language = 'en', onOptimize }) {
  const [optimizationData, setOptimizationData] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  const t = {
    en: {
      title: 'AI Meeting Optimizer',
      subtitle: 'Get intelligent suggestions to improve your meetings',
      analyzeAll: 'Analyze All Meetings',
      analyzeSelected: 'Analyze Selected Meeting',
      selectMeeting: 'Select a meeting to analyze',
      optimizationScore: 'Optimization Score',
      durationEfficiency: 'Duration Efficiency',
      engagementLevel: 'Engagement Level',
      agendaStructure: 'Agenda Structure',
      followUpEffectiveness: 'Follow-up Effectiveness',
      technologyUsage: 'Technology Usage',
      overallQuality: 'Overall Quality',
      applyOptimization: 'Apply Optimization',
      optimizationSuggestions: 'Optimization Suggestions',
      durationOptimization: 'Duration Optimization',
      engagementImprovements: 'Engagement Improvements',
      agendaSuggestions: 'Agenda Suggestions',
      followUpOptimization: 'Follow-up Optimization',
      technologyRecommendations: 'Technology Recommendations',
      overallRecommendations: 'Overall Recommendations',
      noMeetings: 'No meetings to optimize',
      noMeetingsSubtext: 'Create some meetings first to get optimization suggestions',
      error: 'Error',
      failedToAnalyze: 'Failed to analyze meetings. Please try again.',
      success: 'Success',
      optimizationApplied: 'Optimization suggestions applied successfully!',
    },
    es: {
      title: 'Optimizador de Reuniones IA',
      subtitle: 'Obtén sugerencias inteligentes para mejorar tus reuniones',
      analyzeAll: 'Analizar Todas las Reuniones',
      analyzeSelected: 'Analizar Reunión Seleccionada',
      selectMeeting: 'Selecciona una reunión para analizar',
      optimizationScore: 'Puntuación de Optimización',
      durationEfficiency: 'Eficiencia de Duración',
      engagementLevel: 'Nivel de Participación',
      agendaStructure: 'Estructura de Agenda',
      followUpEffectiveness: 'Efectividad de Seguimiento',
      technologyUsage: 'Uso de Tecnología',
      overallQuality: 'Calidad General',
      applyOptimization: 'Aplicar Optimización',
      optimizationSuggestions: 'Sugerencias de Optimización',
      durationOptimization: 'Optimización de Duración',
      engagementImprovements: 'Mejoras de Participación',
      agendaSuggestions: 'Sugerencias de Agenda',
      followUpOptimization: 'Optimización de Seguimiento',
      technologyRecommendations: 'Recomendaciones de Tecnología',
      overallRecommendations: 'Recomendaciones Generales',
      noMeetings: 'No hay reuniones para optimizar',
      noMeetingsSubtext: 'Crea algunas reuniones primero para obtener sugerencias de optimización',
      error: 'Error',
      failedToAnalyze: 'Error al analizar reuniones. Por favor inténtalo de nuevo.',
      success: 'Éxito',
      optimizationApplied: '¡Sugerencias de optimización aplicadas exitosamente!',
    },
  };

  useEffect(() => {
    if (meetings.length > 0) {
      analyzeAllMeetings();
    }
  }, [meetings]);

  const analyzeAllMeetings = async () => {
    setIsAnalyzing(true);
    try {
      const recentMeetings = meetings.slice(0, 10); // Analyze last 10 meetings
      const optimizations = [];

      for (const meeting of recentMeetings) {
        try {
          const optimization = await aiService.optimizeMeeting(
            meeting,
            meeting.feedback || '',
            language
          );
          optimizations.push({
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            ...optimization,
          });
        } catch (error) {
          console.error(`Error optimizing meeting ${meeting.id}:`, error);
        }
      }

      // Calculate overall optimization score
      const overallScore = optimizations.length > 0 
        ? Math.round(optimizations.reduce((sum, opt) => sum + opt.quality_score, 0) / optimizations.length)
        : 0;

      setOptimizationData({
        overallScore,
        optimizations,
        summary: generateOptimizationSummary(optimizations, language),
      });
    } catch (error) {
      console.error('Error analyzing meetings:', error);
      Alert.alert(t[language].error, t[language].failedToAnalyze);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeSelectedMeeting = async (meeting) => {
    setSelectedMeeting(meeting);
    setIsAnalyzing(true);
    try {
      const optimization = await aiService.optimizeMeeting(
        meeting,
        meeting.feedback || '',
        language
      );
      
      setOptimizationData({
        overallScore: optimization.quality_score,
        optimizations: [{
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          ...optimization,
        }],
        summary: generateOptimizationSummary([optimization], language),
      });
    } catch (error) {
      console.error('Error analyzing selected meeting:', error);
      Alert.alert(t[language].error, t[language].failedToAnalyze);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateOptimizationSummary = (optimizations, lang) => {
    if (optimizations.length === 0) return '';

    const commonIssues = [];
    const commonSuggestions = [];

    optimizations.forEach(opt => {
      if (opt.duration_optimization) commonIssues.push('duration');
      if (opt.engagement_improvements?.length > 0) commonIssues.push('engagement');
      if (opt.agenda_suggestions?.length > 0) commonIssues.push('agenda');
      
      opt.overall_recommendations?.forEach(rec => {
        if (!commonSuggestions.includes(rec)) {
          commonSuggestions.push(rec);
        }
      });
    });

    return {
      commonIssues: [...new Set(commonIssues)],
      commonSuggestions: commonSuggestions.slice(0, 3),
      totalMeetings: optimizations.length,
    };
  };

  const applyOptimization = (optimization) => {
    if (onOptimize) {
      onOptimize(optimization);
      Alert.alert(t[language].success, t[language].optimizationApplied);
    }
  };

  const renderOptimizationCard = (optimization) => (
    <Card key={optimization.meetingId} style={styles.optimizationCard}>
      <Card.Content>
        <View style={styles.optimizationHeader}>
          <Title style={styles.meetingTitle}>{optimization.meetingTitle}</Title>
          <Chip mode="outlined" style={styles.scoreChip}>
            {optimization.quality_score}%
          </Chip>
        </View>

        <View style={styles.scoreSection}>
          <Text style={styles.scoreLabel}>{t[language].optimizationScore}</Text>
          <ProgressBar 
            progress={optimization.quality_score / 100} 
            color={optimization.quality_score > 80 ? '#10B981' : optimization.quality_score > 60 ? '#F59E0B' : '#EF4444'}
            style={styles.progressBar}
          />
        </View>

        {optimization.duration_optimization && (
          <View style={styles.suggestionSection}>
            <Text style={styles.sectionTitle}>{t[language].durationOptimization}</Text>
            <Text style={styles.suggestionText}>{optimization.duration_optimization}</Text>
          </View>
        )}

        {optimization.engagement_improvements?.length > 0 && (
          <View style={styles.suggestionSection}>
            <Text style={styles.sectionTitle}>{t[language].engagementImprovements}</Text>
            {optimization.engagement_improvements.map((improvement, index) => (
              <Text key={index} style={styles.suggestionText}>• {improvement}</Text>
            ))}
          </View>
        )}

        {optimization.agenda_suggestions?.length > 0 && (
          <View style={styles.suggestionSection}>
            <Text style={styles.sectionTitle}>{t[language].agendaSuggestions}</Text>
            {optimization.agenda_suggestions.map((suggestion, index) => (
              <Text key={index} style={styles.suggestionText}>• {suggestion}</Text>
            ))}
          </View>
        )}

        {optimization.follow_up_optimization?.length > 0 && (
          <View style={styles.suggestionSection}>
            <Text style={styles.sectionTitle}>{t[language].followUpOptimization}</Text>
            {optimization.follow_up_optimization.map((optimization, index) => (
              <Text key={index} style={styles.suggestionText}>• {optimization}</Text>
            ))}
          </View>
        )}

        {optimization.technology_recommendations?.length > 0 && (
          <View style={styles.suggestionSection}>
            <Text style={styles.sectionTitle}>{t[language].technologyRecommendations}</Text>
            {optimization.technology_recommendations.map((rec, index) => (
              <Text key={index} style={styles.suggestionText}>• {rec}</Text>
            ))}
          </View>
        )}

        <Button
          mode="contained"
          onPress={() => applyOptimization(optimization)}
          style={styles.applyButton}
          icon="check"
        >
          {t[language].applyOptimization}
        </Button>
      </Card.Content>
    </Card>
  );

  const renderMeetingSelector = () => (
    <Card style={styles.selectorCard}>
      <Card.Content>
        <Title style={styles.selectorTitle}>{t[language].selectMeeting}</Title>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {meetings.slice(0, 5).map((meeting) => (
            <TouchableOpacity
              key={meeting.id}
              onPress={() => analyzeSelectedMeeting(meeting)}
              style={[
                styles.meetingChip,
                selectedMeeting?.id === meeting.id && styles.selectedChip
              ]}
            >
              <Text style={[
                styles.meetingChipText,
                selectedMeeting?.id === meeting.id && styles.selectedChipText
              ]}>
                {meeting.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Card.Content>
    </Card>
  );

  if (meetings.length === 0) {
    return (
      <Card style={styles.emptyCard}>
        <Card.Content style={styles.emptyContent}>
          <MaterialIcons name="psychology" size={48} color="#9CA3AF" />
          <Title style={styles.emptyTitle}>{t[language].noMeetings}</Title>
          <Paragraph style={styles.emptySubtext}>{t[language].noMeetingsSubtext}</Paragraph>
        </Card.Content>
      </Card>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <MaterialIcons name="tune" size={24} color="#8B5CF6" />
        <Title style={styles.title}>{t[language].title}</Title>
      </View>
      
      <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>

      {renderMeetingSelector()}

      <View style={styles.buttonContainer}>
        <Button
          mode="contained"
          onPress={analyzeAllMeetings}
          loading={isAnalyzing}
          disabled={isAnalyzing}
          style={styles.analyzeButton}
          icon="analytics"
        >
          {t[language].analyzeAll}
        </Button>
      </View>

      {isAnalyzing && (
        <Card style={styles.loadingCard}>
          <Card.Content style={styles.loadingContent}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingText}>Analyzing meetings...</Text>
          </Card.Content>
        </Card>
      )}

      {optimizationData && !isAnalyzing && (
        <View style={styles.resultsContainer}>
          <Card style={styles.summaryCard}>
            <Card.Content>
              <View style={styles.summaryHeader}>
                <MaterialIcons name="insights" size={24} color="#8B5CF6" />
                <Title style={styles.summaryTitle}>Optimization Summary</Title>
              </View>
              
              <View style={styles.summaryStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{optimizationData.overallScore}%</Text>
                  <Text style={styles.statLabel}>Overall Score</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{optimizationData.summary.totalMeetings}</Text>
                  <Text style={styles.statLabel}>Meetings Analyzed</Text>
                </View>
              </View>

              {optimizationData.summary.commonIssues.length > 0 && (
                <View style={styles.commonIssues}>
                  <Text style={styles.sectionTitle}>Common Issues</Text>
                  <View style={styles.chipContainer}>
                    {optimizationData.summary.commonIssues.map((issue, index) => (
                      <Chip key={index} mode="outlined" style={styles.issueChip}>
                        {issue}
                      </Chip>
                    ))}
                  </View>
                </View>
              )}

              {optimizationData.summary.commonSuggestions.length > 0 && (
                <View style={styles.commonSuggestions}>
                  <Text style={styles.sectionTitle}>Top Recommendations</Text>
                  {optimizationData.summary.commonSuggestions.map((suggestion, index) => (
                    <Text key={index} style={styles.suggestionText}>• {suggestion}</Text>
                  ))}
                </View>
              )}
            </Card.Content>
          </Card>

          <View style={styles.optimizationsList}>
            {optimizationData.optimizations.map(renderOptimizationCard)}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 8,
  },
  title: {
    marginLeft: 8,
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    fontSize: 16,
    color: '#64748B',
  },
  selectorCard: {
    margin: 20,
    marginTop: 0,
  },
  selectorTitle: {
    fontSize: 18,
    marginBottom: 12,
  },
  meetingChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectedChip: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  meetingChipText: {
    fontSize: 14,
    color: '#374151',
  },
  selectedChipText: {
    color: '#FFFFFF',
  },
  buttonContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  analyzeButton: {
    backgroundColor: '#8B5CF6',
  },
  loadingCard: {
    margin: 20,
  },
  loadingContent: {
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748B',
  },
  resultsContainer: {
    padding: 20,
    paddingTop: 0,
  },
  summaryCard: {
    marginBottom: 20,
    backgroundColor: '#F8FAFC',
    borderColor: '#8B5CF6',
    borderWidth: 1,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryTitle: {
    marginLeft: 8,
    fontSize: 18,
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  commonIssues: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  issueChip: {
    borderColor: '#F59E0B',
  },
  commonSuggestions: {
    marginBottom: 8,
  },
  suggestionText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 4,
  },
  optimizationsList: {
    gap: 16,
  },
  optimizationCard: {
    backgroundColor: '#FFFFFF',
    elevation: 2,
  },
  optimizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  meetingTitle: {
    flex: 1,
    fontSize: 16,
    marginRight: 8,
  },
  scoreChip: {
    borderColor: '#8B5CF6',
  },
  scoreSection: {
    marginBottom: 16,
  },
  scoreLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  suggestionSection: {
    marginBottom: 16,
  },
  applyButton: {
    backgroundColor: '#8B5CF6',
    marginTop: 8,
  },
  emptyCard: {
    margin: 20,
    backgroundColor: '#FFFFFF',
  },
  emptyContent: {
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1E293B',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
});