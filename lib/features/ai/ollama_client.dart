import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thin wrapper around a local Ollama server's REST API
/// (https://github.com/ollama/ollama/blob/main/docs/api.md). Nothing in
/// FlowSync ever leaves the device: `host` defaults to the Ollama's own
/// loopback address, and the model only ever sees the prompt text we build
/// in [SuggestionEngine] from data already on-device.
class OllamaClient {
  OllamaClient({this.host = 'http://localhost:11434', this.model = 'llama3.2'});

  final String host;
  final String model;

  /// True if an Ollama server is reachable at [host].
  Future<bool> isAvailable() async {
    try {
      final res = await http.get(Uri.parse('$host/api/tags')).timeout(const Duration(seconds: 2));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Sends [prompt] and returns the full (non-streamed) response text.
  /// [system] is an optional system prompt steering output format/tone.
  Future<String> generate(String prompt, {String? system}) async {
    final res = await http.post(
      Uri.parse('$host/api/generate'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'model': model,
        'prompt': prompt,
        if (system != null) 'system': system,
        'stream': false,
      }),
    );

    if (res.statusCode != 200) {
      throw OllamaException('Ollama returned ${res.statusCode}: ${res.body}');
    }
    final decoded = jsonDecode(res.body) as Map<String, Object?>;
    return decoded['response'] as String? ?? '';
  }
}

class OllamaException implements Exception {
  OllamaException(this.message);
  final String message;
  @override
  String toString() => 'OllamaException: $message';
}
