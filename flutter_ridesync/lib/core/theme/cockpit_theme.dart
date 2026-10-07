import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class CockpitTheme {
  // OLED Tactical Night Colors
  static const Color darkBackground = Color(0xFF070A0F);
  static const Color surfaceColor = Color(0xFF131924);
  static const Color surfaceLight = Color(0xFF243046);
  
  static const Color primaryAmber = Color(0xFFFF6B00); // Safety Orange
  static const Color accentOrange = Color(0xFFFF9100);
  static const Color successGreen = Color(0xFF00E676);
  static const Color warningYellow = Color(0xFFFFD600);
  static const Color dangerRed = Color(0xFFFF1744);
  static const Color cyanAccent = Color(0xFF00E5FF);

  static const Color textBright = Color(0xFFFFFFFF);
  static const Color textMuted = Color(0xFF94A3B8);

  // Sunlight Ultra-Visibility Day Colors
  static const Color sunlightBackground = Color(0xFFF1F5F9);
  static const Color sunlightSurface = Color(0xFFFFFFFF);
  static const Color sunlightSurfaceBorder = Color(0xFF94A3B8);
  static const Color sunlightTextPrimary = Color(0xFF020617);
  static const Color sunlightPrimaryOrange = Color(0xFFD94600);

  static ThemeData get theme => nightTheme;

  /// OLED Tactical Midnight Night Mode (Default)
  static ThemeData get nightTheme {
    return ThemeData.dark().copyWith(
      scaffoldBackgroundColor: darkBackground,
      primaryColor: primaryAmber,
      colorScheme: const ColorScheme.dark(
        primary: primaryAmber,
        secondary: accentOrange,
        surface: surfaceColor,
        background: darkBackground,
        error: dangerRed,
      ),
      cardTheme: CardTheme(
        color: surfaceColor,
        elevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: surfaceLight, width: 1.5),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: darkBackground,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: textBright,
        ),
      ),
      textTheme: TextTheme(
        displayLarge: GoogleFonts.outfit(fontSize: 36, fontWeight: FontWeight.bold, color: textBright),
        headlineMedium: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.w700, color: textBright),
        titleLarge: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w600, color: textBright),
        bodyLarge: GoogleFonts.inter(fontSize: 16, color: textBright),
        bodyMedium: GoogleFonts.inter(fontSize: 14, color: textMuted),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryAmber,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }

  /// Sunlight High-Visibility Day Mode (Direct Sun Glare Legibility)
  static ThemeData get sunlightTheme {
    return ThemeData.light().copyWith(
      scaffoldBackgroundColor: sunlightBackground,
      primaryColor: sunlightPrimaryOrange,
      colorScheme: const ColorScheme.light(
        primary: sunlightPrimaryOrange,
        secondary: Color(0xFF0284C7),
        surface: sunlightSurface,
        background: sunlightBackground,
        error: Color(0xFFDC2626),
      ),
      cardTheme: CardTheme(
        color: sunlightSurface,
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: sunlightSurfaceBorder, width: 2),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: sunlightSurface,
        elevation: 1,
        centerTitle: true,
        iconTheme: IconThemeData(color: sunlightTextPrimary),
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: sunlightTextPrimary,
        ),
      ),
      textTheme: TextTheme(
        displayLarge: GoogleFonts.outfit(fontSize: 36, fontWeight: FontWeight.extrabold, color: sunlightTextPrimary),
        headlineMedium: GoogleFonts.outfit(fontSize: 24, fontWeight: FontWeight.bold, color: sunlightTextPrimary),
        titleLarge: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: sunlightTextPrimary),
        bodyLarge: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600, color: sunlightTextPrimary),
        bodyMedium: GoogleFonts.inter(fontSize: 14, color: Color(0xFF334155)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: sunlightPrimaryOrange,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }
}

