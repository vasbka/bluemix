#!/usr/bin/env ruby
# Encoding: utf-8
# IBM SDK for Node.js Buildpack
# Copyright 2014 the original author or authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Usage: install_handlers.rb TARGET_FOLDER [HANDLERS..]
#
# For each HANDLER given in ARGV, runs the correspondingly named `install-#{HANDLER}` handler.
#
raise 'TARGET_FOLDER is required' if ARGV[0].nil?
target_dir = File.expand_path(ARGV[0])
handler_list = ARGV.slice(1, ARGV.length)

app_mgmt_dir = File.expand_path('..', File.dirname(__FILE__))

$LOAD_PATH.unshift app_mgmt_dir

require 'utils/handlers'
require 'utils/simple_logger'

def do_install(handlers)
  return if handlers.empty?
  env = ENV
  command = handlers.map(&:start_script).join(' ; ')
  Utils::SimpleLogger.info("Install utilities using #{command}")
  system(env, command.to_s)
end

if handler_list.nil? || handler_list.empty?
  Utils::SimpleLogger.warning('No utilities were specified to install')
  exit 0
end

handlers = Utils::Handlers.new(target_dir, 'install')
valid, invalid = handlers.validate(handler_list)
Utils::SimpleLogger.warning("The following utilities are invalid and cannot be executed: #{invalid.join(', ')}") unless invalid.empty?
Utils::SimpleLogger.info("Installing app management utilities: #{valid.join(', ')}")

sync, async = handlers.executions(handler_list)
do_install(sync + async)
